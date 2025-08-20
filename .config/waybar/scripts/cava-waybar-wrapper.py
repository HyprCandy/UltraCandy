#!/usr/bin/env python3
"""
Cava Wrapper for Waybar - Shows visualizer only when media is playing
"""

import subprocess
import time
import json
import sys
import os
import signal
import threading
from pathlib import Path

class MediaDetector:
    """Detect if media is currently playing using playerctl"""
    
    def __init__(self):
        self.last_status = None
        
    def is_media_playing(self):
        """Check if any media player is currently playing"""
        try:
            # Check if playerctl is available
            result = subprocess.run(
                ["playerctl", "status"],
                capture_output=True,
                text=True,
                timeout=1
            )
            
            if result.returncode == 0:
                status = result.stdout.strip().lower()
                return status == "playing"
            else:
                # No players found or playerctl not available
                return False
                
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
            return False
    
    def get_media_info(self):
        """Get current media information"""
        try:
            artist_result = subprocess.run(
                ["playerctl", "metadata", "artist"],
                capture_output=True,
                text=True,
                timeout=1
            )
            
            title_result = subprocess.run(
                ["playerctl", "metadata", "title"],
                capture_output=True,
                text=True,
                timeout=1
            )
            
            artist = artist_result.stdout.strip() if artist_result.returncode == 0 else "Unknown Artist"
            title = title_result.stdout.strip() if title_result.returncode == 0 else "Unknown Title"
            
            return f"{artist} - {title}"
            
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
            return "Media Playing"

class CavaWaybarWrapper:
    """Wrapper that manages cava output based on media status"""
    
    def __init__(self):
        self.media_detector = MediaDetector()
        self.cava_process = None
        self.should_stop = False
        self.current_media_status = False
        
        # Get the directory where this script is located
        script_dir = os.path.dirname(os.path.abspath(__file__))
        self.cava_script_path = os.path.join(script_dir, "cava.py")
        
        # Check if cava.py exists in the same directory
        if not os.path.exists(self.cava_script_path):
            # Fallback to looking in common locations
            possible_paths = [
                os.path.expanduser("~/.config/waybar/scripts/cava.py"),
                os.path.expanduser("~/.local/bin/cava.py"),
                "cava.py"  # Current directory
            ]
            
            for path in possible_paths:
                if os.path.exists(path):
                    self.cava_script_path = path
                    break
            else:
                print("Error: Could not find cava.py script", file=sys.stderr)
                sys.exit(1)
    
    def start_cava(self):
        """Start the cava process"""
        if self.cava_process is None:
            try:
                self.cava_process = subprocess.Popen(
                    ["python3", self.cava_script_path, "waybar", "--json"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=0
                )
            except Exception as e:
                print(f"Error starting cava: {e}", file=sys.stderr)
    
    def stop_cava(self):
        """Stop the cava process"""
        if self.cava_process:
            try:
                self.cava_process.terminate()
                self.cava_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.cava_process.kill()
            except Exception:
                pass
            finally:
                self.cava_process = None
    
    def output_empty_state(self):
        """Output empty/hidden state for waybar"""
        output = {
            "text": "",
            "tooltip": "Cava - No media playing",
            "class": "cava-hidden"
        }
        print(json.dumps(output), flush=True)
    
    def run(self):
        """Main run loop"""
        # Set up signal handlers for clean shutdown
        def signal_handler(signum, frame):
            self.should_stop = True
            self.stop_cava()
            sys.exit(0)
        
        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)
        
        try:
            while not self.should_stop:
                media_playing = self.media_detector.is_media_playing()
                
                if media_playing and not self.current_media_status:
                    # Media started playing - start cava
                    self.start_cava()
                    self.current_media_status = True
                    
                elif not media_playing and self.current_media_status:
                    # Media stopped playing - stop cava and show empty state
                    self.stop_cava()
                    self.current_media_status = False
                    self.output_empty_state()
                
                if media_playing and self.cava_process:
                    # Forward cava output
                    try:
                        line = self.cava_process.stdout.readline()
                        if line:
                            # Parse the JSON from cava and potentially modify it
                            try:
                                cava_data = json.loads(line.strip())
                                # Add media info to tooltip
                                media_info = self.media_detector.get_media_info()
                                cava_data["tooltip"] = f"Cava - {media_info}"
                                cava_data["class"] = "cava-active"
                                print(json.dumps(cava_data), flush=True)
                            except json.JSONDecodeError:
                                # If it's not JSON, just pass it through
                                print(line.strip(), flush=True)
                        else:
                            # Cava process ended
                            self.stop_cava()
                    except Exception as e:
                        print(f"Error reading cava output: {e}", file=sys.stderr)
                        self.stop_cava()
                
                elif not media_playing:
                    # No media playing, output empty state periodically
                    self.output_empty_state()
                
                # Check every 2 seconds
                time.sleep(2)
                
        except KeyboardInterrupt:
            pass
        finally:
            self.stop_cava()

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("Cava Wrapper for Waybar - Shows visualizer only when media is playing")
        print("Usage: cava-waybar-wrapper.py")
        print("\nRequires:")
        print("- playerctl (to detect media status)")
        print("- cava.py script (for audio visualization)")
        sys.exit(0)
    
    wrapper = CavaWaybarWrapper()
    wrapper.run()

if __name__ == "__main__":
    main()
