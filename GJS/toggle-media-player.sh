#!/bin/bash

# Check if the process is running
if pgrep -f "media-main.js" > /dev/null; then
    # If running, kill it
    killall gjs ~/.hyprcandy/GJS/media-main.js
else
    # If not running, start it
    gjs ~/.hyprcandy/GJS/media-main.js &
fi
