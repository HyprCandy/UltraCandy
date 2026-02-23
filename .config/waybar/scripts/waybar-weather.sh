#!/bin/bash

# Waybar Weather Module - Accurate Location Detection
# Uses Open-Meteo (No API Key Required) with precise coordinates from ipinfo

UNIT_STATE_FILE="/tmp/waybar-weather-unit"
WEATHER_CACHE_FILE="/tmp/astal-weather-cache.json"
LOCATION_CACHE_FILE="/tmp/waybar-weather-location"
IPINFO_CACHE_FILE="/tmp/waybar-weather-ipinfo.json"
CACHE_MAX_AGE=300  # 5 minutes
LOCATION_MAX_AGE=3600  # 1 hour

# Get current unit
CURRENT_UNIT=$(cat "$UNIT_STATE_FILE" 2>/dev/null || echo "metric")

# Get precise location from ipinfo (with coordinates)
get_location() {
    if [ -f "$IPINFO_CACHE_FILE" ]; then
        CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$IPINFO_CACHE_FILE") ))
        if [ $CACHE_AGE -lt $LOCATION_MAX_AGE ]; then
            cat "$IPINFO_CACHE_FILE"
            return
        fi
    fi
    
    # Fetch full ipinfo data (includes city, region, country, and coordinates)
    IPINFO_DATA=$(curl -s https://ipinfo.io/json)
    if [ -n "$IPINFO_DATA" ]; then
        echo "$IPINFO_DATA" > "$IPINFO_CACHE_FILE"
        echo "$IPINFO_DATA"
    else
        # Fallback to cached data if available
        if [ -f "$IPINFO_CACHE_FILE" ]; then
            cat "$IPINFO_CACHE_FILE"
        else
            echo '{"loc":"0,0","city":"Unknown","region":"","country":"Unknown"}'
        fi
    fi
}

IPINFO=$(get_location)

# Extract coordinates and location details
COORDINATES=$(echo "$IPINFO" | jq -r '.loc // "0,0"')
CITY=$(echo "$IPINFO" | jq -r '.city // "Unknown"')

# Split coordinates into separate latitude and longitude for Open-Meteo
LAT=$(echo "$COORDINATES" | cut -d',' -f1)
LON=$(echo "$COORDINATES" | cut -d',' -f2)

# Display location: Simple "City" format
DISPLAY_LOCATION="$CITY"

# Open-Meteo API URL (Fetches metric by default, handles Imperial conversions dynamically via jq)
WEATHER_URL="https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&timezone=auto"

# Check cache freshness
if [ -f "$WEATHER_CACHE_FILE" ]; then
    CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$WEATHER_CACHE_FILE") ))
    if [ $CACHE_AGE -lt $CACHE_MAX_AGE ]; then
        # Use cached data
        WEATHER_DATA=$(cat "$WEATHER_CACHE_FILE")
    else
        # Fetch new data using coordinates
        WEATHER_DATA=$(curl -s "$WEATHER_URL")
        # Validate that the API returned a structured 'current' object
        if [ -n "$WEATHER_DATA" ] && echo "$WEATHER_DATA" | jq -e '.current' >/dev/null 2>&1; then
            echo "$WEATHER_DATA" > "$WEATHER_CACHE_FILE"
        else
            # Use old cache if fetch failed
            WEATHER_DATA=$(cat "$WEATHER_CACHE_FILE" 2>/dev/null || echo '{}')
        fi
    fi
else
    # Fetch new data
    WEATHER_DATA=$(curl -s "$WEATHER_URL")
    if [ -n "$WEATHER_DATA" ] && echo "$WEATHER_DATA" | jq -e '.current' >/dev/null 2>&1; then
        echo "$WEATHER_DATA" > "$WEATHER_CACHE_FILE"
    else
        echo '{"error":"Unable to fetch weather"}' >&2
        exit 1
    fi
fi

# Parse weather data with jq (GLYPH VERSION - Nerd Font icons)
# Converts standard WMO codes into weather text and assigns day/night logic
jq --arg unit "$CURRENT_UNIT" \
   --arg display_loc "$DISPLAY_LOCATION" \
   -rc '
    # Weather icon mapping using standard Open-Meteo WMO weather interpretation codes
    # Requires a Nerd Font installed (e.g., JetBrainsMono Nerd Font)
    def get_condition_info(code; is_day):
        if (code == 0) then {text: "Clear sky", icon: (if is_day == 1 then "󰖙" else "󰖔" end)}
        elif (code == 1) then {text: "Mainly clear", icon: (if is_day == 1 then "󰖕" else "󰼱" end)}
        elif (code == 2) then {text: "Partly cloudy", icon: (if is_day == 1 then "󰖕" else "󰼱" end)}
        elif (code == 3) then {text: "Overcast", icon: "󰼰"}
        elif (code == 45 or code == 48) then {text: "Fog", icon: "󰖑"}
        elif (code == 51 or code == 53 or code == 55) then {text: "Drizzle", icon: "󰖗"}
        elif (code == 56 or code == 57) then {text: "Freezing Drizzle", icon: "󰖒"}
        elif (code == 61) then {text: "Slight Rain", icon: "󰖗"}
        elif (code == 63) then {text: "Moderate Rain", icon: "󰖖"}
        elif (code == 65) then {text: "Heavy Rain", icon: "󰙾"}
        elif (code == 66 or code == 67) then {text: "Freezing Rain", icon: "󰙿"}
        elif (code == 71) then {text: "Slight Snow", icon: "󰜗"}
        elif (code == 73) then {text: "Moderate Snow", icon: "󰜗"}
        elif (code == 75) then {text: "Heavy Snow", icon: "󰜗"}
        elif (code == 77) then {text: "Snow Grains", icon: "󰖘"}
        elif (code == 80 or code == 81 or code == 82) then {text: "Rain Showers", icon: "󰙾"}
        elif (code == 85 or code == 86) then {text: "Snow Showers", icon: "󰼶"}
        elif (code == 95) then {text: "Thunderstorm", icon: "󰖓"}
        elif (code == 96 or code == 99) then {text: "Thunderstorm with Hail", icon: "󰖓"}
        else {text: "Unknown", icon: "󰖐"} end;
    
    .current as $current |
    
    # Retrieve mapped logic using weather_code and native is_day parameter
    get_condition_info($current.weather_code; $current.is_day) as $condition |
    
    # Dynamic Unit Math (Data comes in Metric, handled by jq if Imperial is requested)
    (if $unit == "metric" then
        { 
            temp: $current.temperature_2m, 
            feel: $current.apparent_temperature, 
            unit: "°C", 
            speed: "\($current.wind_speed_10m) km/h"
        }
    else
        { 
            temp: ($current.temperature_2m * 9 / 5 + 32), 
            feel: ($current.apparent_temperature * 9 / 5 + 32), 
            unit: "°F", 
            speed: "\($current.wind_speed_10m * 0.621371 | floor) mph"
        }
    end) as $data |
    
    {
        "text": "\($data.temp | round)\($data.unit) \($condition.icon)",
        "tooltip": "\($condition.icon) <b>\($condition.text)</b>\n Location: \($display_loc)\n󰔐 Feels like: \($data.feel | round)\($data.unit)\n󰖌 Humidity: \($current.relative_humidity_2m)%\n󰖝 Wind: \($data.speed)\n-------------------\nScroll-Up: °C\nScroll-Down: °F\nClick: Weather Menu",
        "class": "weather",
        "alt": $condition.text
    }
' <<< "$WEATHER_DATA"
