#!/bin/bash
# toggle-dock.sh  –  instant hide / restore without immediate relaunch
STATE_FILE="$HOME/.config/hyprcandy/scripts/.dock-position-state"
FLAG_FILE="$HOME/.config/hyprcandy/scripts/.dock-was-hidden-by-toggle"
PRESET_HIDDEN="$HOME/.config/hyprcandy/hooks/nwg_dock_presets.sh hidden"

DOCK_SCRIPTS=(
    "$HOME/.config/nwg-dock-hyprland/launch.sh"
    "$HOME/.config/hyprcandy/scripts/left-dock.sh"
    "$HOME/.config/hyprcandy/scripts/right-dock.sh"
    "$HOME/.config/hyprcandy/scripts/top-dock.sh"
)

# 1. ensure state file exists
[ -f "$STATE_FILE" ] || echo "0" > "$STATE_FILE"
CURRENT_POS=$(<"$STATE_FILE")

# 2. dock running ?  ->  hide + flag
if pgrep -f "nwg-dock-hyprland" >/dev/null; then
    pkill -f "nwg-dock-hyprland"          # instant kill
    "$PRESET_HIDDEN" >/dev/null 2>&1     # your preset script (just in case)
    touch "$FLAG_FILE"
    exit 0
fi

# 3. dock dead – restore only if WE hid it last time
if [ -f "$FLAG_FILE" ]; then
    rm "$FLAG_FILE"
    SCRIPT="${DOCK_SCRIPTS[$CURRENT_POS]}"
    [ -x "$SCRIPT" ] || { echo "0" > "$STATE_FILE"; SCRIPT="${DOCK_SCRIPTS[0]}"; }
    nohup "$SCRIPT" >/dev/null 2>&1 &
fi

#4.  LOGIN MODE (exec-once) – always spawn
if [[ "$1" == "--restore" ]]; then
    # always start on the edge saved in STATE_FILE
    SCRIPT="${DOCK_SCRIPTS[$CURRENT_POS]}"
    [ -x "$SCRIPT" ] || { echo "0" > "$STATE_FILE"; SCRIPT="${DOCK_SCRIPTS[0]}"; }
    nohup "$SCRIPT" >/dev/null 2>&1 &
    exit 0
fi
