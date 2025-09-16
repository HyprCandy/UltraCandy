#!/bin/bash

# TTY-Clock Script
# Launches kitty in floating mode and runs the tty-clock

kitty --class="clock" \
      --override=initial_window_width=400 \
      --override=initial_window_height=200 \
      -e bash -c "tty-clock -s -c"
