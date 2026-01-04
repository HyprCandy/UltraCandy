#!/bin/bash

# TTY-Clock Script
# Launches kitty in floating mode and runs the tty-clock

kitty --app-id="clock" \
      -e bash -c "tty-clock -s -c"
