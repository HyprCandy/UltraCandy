#!/bin/bash

STATE_FILE="/tmp/waybar-weather-unit"

# Read unit preference from state file, default to metric
if [ -f "$STATE_FILE" ]; then
    UNITS=$(cat "$STATE_FILE")
else
    UNITS="metric"
fi

SYMBOL="°F"
[ "$UNITS" = "metric" ] && SYMBOL="°C"

# Fetch weather data from wttr.in
weather=$(curl -sf "https://wttr.in/?format=j1")

# Display weather info
if [ -n "$weather" ] && echo "$weather" | jq -e '.current_condition' >/dev/null 2>&1; then
    # Extract temperature
    if [ "$UNITS" = "metric" ]; then
        temp=$(echo "$weather" | jq -r '.current_condition[0].temp_C')
    else
        temp=$(echo "$weather" | jq -r '.current_condition[0].temp_F')
    fi
    
    # Extract weather code
    code=$(echo "$weather" | jq -r '.current_condition[0].weatherCode')
    
    # Determine if it's day or night (wttr.in doesn't provide this directly, so we'll simplify)
    # For more accuracy, you could parse the astronomy data from wttr.in
    hour=$(date +%H)
    is_day=1
    [ "$hour" -ge 6 ] && [ "$hour" -lt 18 ] && is_day=1 || is_day=0
    
    # Map weather codes to icons (wttr.in uses different codes than open-meteo)
    case $code in
        113) # Clear/Sunny
            if [ "$is_day" -eq 1 ]; then
                icon="☀️"
            else
                icon="🌙"
            fi
            ;;
        116|119|122) icon="⛅" ;; # Partly cloudy, Cloudy, Overcast
        143|248|260) icon="🌫️" ;; # Mist, Fog
        176|263|266|293|296|299|353) icon="🌧️" ;; # Light rain variations
        182|185|281|284|311|314|317|350|362|365|374|377) icon="🌦️" ;; # Sleet/mixed
        179|227|230|320|323|326|329|332|335|338|368|371) icon="❄️" ;; # Snow
        200|386|389|392|395) icon="⛈️" ;; # Thunder
        *) icon="🌈" ;;
    esac
    
    echo "$temp$SYMBOL $icon"
else
    echo "N/A"
fi
