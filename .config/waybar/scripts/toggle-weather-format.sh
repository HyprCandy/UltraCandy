#!/bin/bash

STATE_FILE="/tmp/waybar-weather-unit"

# Parse command line arguments
case "$1" in
    -c) echo "metric" > "$STATE_FILE" ;;
    -f) echo "imperial" > "$STATE_FILE" ;;
    *) echo "Usage: $0 [-f|-c]" >&2; exit 1 ;;
esac

# Trigger waybar refresh by sending SIGRTMIN+8 (adjust the number based on your setup)
pkill -SIGUSR2 waybar
