#!/bin/bash

# Waybar Weather Module - Accurate Location Detection
# Uses WeatherAPI.com with precise coordinates from ipinfo

WEATHER_API_KEY="bd6beb7dd25a42ec9b295232250504"
UNIT_STATE_FILE="/tmp/waybar-weather-unit"
WEATHER_CACHE_FILE="/tmp/astal-weather-cache.json"
LOCATION_CACHE_FILE="/tmp/waybar-weather-location"
IPINFO_CACHE_FILE="/tmp/waybar-weather-ipinfo.json"
CACHE_MAX_AGE=600  # 10 minutes
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
REGION=$(echo "$IPINFO" | jq -r '.region // ""')
COUNTRY=$(echo "$IPINFO" | jq -r '.country // "Unknown"')

# Display location: Simple "City, Country" format
DISPLAY_LOCATION="$CITY, $COUNTRY"

# Use coordinates for weather query (most accurate - pinpoints exact location)
# WeatherAPI will find the nearest weather station to these coordinates
# This gives neighborhood-level accuracy rather than city-wide weather
WEATHER_QUERY="$COORDINATES"

# Check cache freshness
if [ -f "$WEATHER_CACHE_FILE" ]; then
    CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$WEATHER_CACHE_FILE") ))
    if [ $CACHE_AGE -lt $CACHE_MAX_AGE ]; then
        # Use cached data
        WEATHER_DATA=$(cat "$WEATHER_CACHE_FILE")
    else
        # Fetch new data using coordinates
        WEATHER_DATA=$(curl -s "https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${WEATHER_QUERY}&days=3&aqi=no&alerts=no")
        if [ -n "$WEATHER_DATA" ] && echo "$WEATHER_DATA" | jq -e '.current' >/dev/null 2>&1; then
            echo "$WEATHER_DATA" > "$WEATHER_CACHE_FILE"
        else
            # Use old cache if fetch failed
            WEATHER_DATA=$(cat "$WEATHER_CACHE_FILE" 2>/dev/null || echo '{}')
        fi
    fi
else
    # Fetch new data
    WEATHER_DATA=$(curl -s "https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${WEATHER_QUERY}&days=3&aqi=no&alerts=no")
    if [ -n "$WEATHER_DATA" ] && echo "$WEATHER_DATA" | jq -e '.current' >/dev/null 2>&1; then
        echo "$WEATHER_DATA" > "$WEATHER_CACHE_FILE"
    else
        echo '{"error":"Unable to fetch weather"}' >&2
        exit 1
    fi
fi

# Get current system time for day/night logic
CURRENT_HOUR=$(date +%H)

# Parse weather data with jq
jq --arg unit "$CURRENT_UNIT" \
   --argjson hour "$CURRENT_HOUR" \
   --arg display_loc "$DISPLAY_LOCATION" \
   -rc '
    # Weather icon mapping with day/night variants
    def get_icon(code; is_day):
        if (code == 1000) then (if is_day then "☀️" else "🌙" end)
        elif (code == 1003) then (if is_day then "⛅" else "☁️" end)
        elif (code == 1006 or code == 1009) then "☁️"
        elif (code == 1030 or code == 1135 or code == 1147) then "🌫️"
        elif (code == 1063 or code == 1150 or code == 1153 or code == 1180 or code == 1240) then "🌦️"
        elif (code >= 1183 and code <= 1201) then "🌧️"
        elif (code >= 1204 and code <= 1237) then "🌨️"
        elif (code >= 1210 and code <= 1225) then "❄️"
        elif (code == 1066 or code == 1069 or code == 1072) then "🌨️"
        elif (code >= 1273) then "⛈️"
        else "🌡️" end;
    
    .current as $current |
    .location as $location |
    
    # Determine day/night based on system time (6 AM to 6 PM)
    (($hour >= 6 and $hour < 18)) as $is_day_system |
    
    (if $unit == "metric" then
        { 
            temp: $current.temp_c, 
            feel: $current.feelslike_c, 
            unit: "°C", 
            speed: "\($current.wind_kph) km/h",
            vis: "\($current.vis_km) km"
        }
    else
        { 
            temp: $current.temp_f, 
            feel: $current.feelslike_f, 
            unit: "°F", 
            speed: "\($current.wind_mph) mph",
            vis: "\($current.vis_miles) mi"
        }
    end) as $data |
    
    {
        "text": "\($data.temp | round)\($data.unit) \(get_icon($current.condition.code; $is_day_system))",
        "tooltip": "<b>\($current.condition.text)</b>\nLocation: \($display_loc)\nFeels like: \($data.feel | round)\($data.unit)\nHumidity: \($current.humidity)%\nWind: \($data.speed)\nVisibility: \($data.vis)\n-------------------\nScroll-Up: °C\nScroll-Down: °F\nClick: Weather Menu",
        "class": "weather",
        "alt": $current.condition.text
    }
' <<< "$WEATHER_DATA"
