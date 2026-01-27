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

#2. LOGIN MODE (exec-once) – always spawn
if [[ "$1" == "--restore" ]]; then
    # always start on the edge saved in STATE_FILE
    SCRIPT="${DOCK_SCRIPTS[$CURRENT_POS]}"
    [ -x "$SCRIPT" ] || { echo "0" > "$STATE_FILE"; SCRIPT="${DOCK_SCRIPTS[0]}"; }
    nohup "$SCRIPT" >/dev/null 2>&1 &
    exit 0
fi

#3. Update dock colors or just reload dock
if [[ "$1" == "--reload" ]]; then
    touch "$FLAG_FILE" >/dev/null 2>&1 &
    sleep 0.5
    "$PRESET_HIDDEN" >/dev/null 2>&1 &  # your preset script (just in case)
    sleep 0.5
    if [ -f "$FLAG_FILE" ]; then
        rm "$FLAG_FILE" >/dev/null 2>&1 &
        sleep 0.5
        SCRIPT="${DOCK_SCRIPTS[$CURRENT_POS]}"
        [ -x "$SCRIPT" ] || { echo "0" > "$STATE_FILE"; SCRIPT="${DOCK_SCRIPTS[0]}"; }
        nohup "$SCRIPT" >/dev/null 2>&1 &
    fi
    exit 0
fi

#4. Relaunch dock
if [[ "$1" == "--relaunch" ]]; then
    case "$CURRENT_POS" in
        0)
            nohup bash -c "$HOME/.config/nwg-dock-hyprland/launch.sh" >/dev/null 2>&1 &
            ;;
        1)
            nohup bash -c "$HOME/.config/hyprcandy/scripts/left-dock.sh" >/dev/null 2>&1 &
            ;;
        2)
            nohup bash -c "$HOME/.config/hyprcandy/scripts/right-dock.sh" >/dev/null 2>&1 &
            ;;
        3)
            nohup bash -c "$HOME/.config/hyprcandy/scripts/top-dock.sh" >/dev/null 2>&1 &
            ;;
        *)
            echo "0" > "$STATE_FILE"
            nohup bash -c "$HOME/.config/nwg-dock-hyprland/launch.sh" >/dev/null 2>&1 &
            ;;
    esac
    sleep 0.2
    exit 0
fi

# 5. dock running ?  ->  hide + flag
if pgrep -f "nwg-dock-hyprland" >/dev/null; then
    pkill -f "nwg-dock-hyprland"          # instant kill
    "$PRESET_HIDDEN" >/dev/null 2>&1     # your preset script (just in case)
    touch "$FLAG_FILE"
    exit 0
fi

# 6. dock dead – restore only if WE hid it last time
if [ -f "$FLAG_FILE" ]; then
    rm "$FLAG_FILE" >/dev/null 2>&1 &
    SCRIPT="${DOCK_SCRIPTS[$CURRENT_POS]}"
    [ -x "$SCRIPT" ] || { echo "0" > "$STATE_FILE"; SCRIPT="${DOCK_SCRIPTS[0]}"; }
    nohup "$SCRIPT" >/dev/null 2>&1 &
fi

#Dock will launch on login and use position tracking when toggled
