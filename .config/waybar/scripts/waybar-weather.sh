#!/bin/bash

# Waybar Weather Module - Accurate Location Detection
# Uses WeatherAPI.com with precise coordinates from ipinfo

WEATHER_API_KEY="YOUR_KEY_HERE"
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
DISPLAY_LOCATION="$CITY" #,$COUNTRY

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

# Parse weather data with jq (GLYPH VERSION - Nerd Font icons)
jq --arg unit "$CURRENT_UNIT" \
   --argjson hour "$CURRENT_HOUR" \
   --arg display_loc "$DISPLAY_LOCATION" \
   -rc '
    # Weather icon mapping with Nerd Font glyphs (better day/night differentiation)
    # Requires a Nerd Font installed (e.g., JetBrainsMono Nerd Font)
    def get_icon(code; is_day):
        # Clear conditions
        if (code == 1000) then (if is_day then "󰖙" else "󰖔" end)  # Sunny / Clear night
        
        # Partly cloudy
        elif (code == 1003) then (if is_day then "󰖕" else "󰼱" end)  # Partly cloudy day/night
        
        # Cloudy
        elif (code == 1006) then "󰖐"  # Cloudy
        elif (code == 1009) then "󰼰"  # Overcast
        
        # Fog/Mist
        elif (code == 1030) then ""  # Mist
        elif (code == 1135) then "󰖑"  # Fog
        elif (code == 1147) then "󰖑"  # Freezing fog
        
        # Patchy rain/drizzle
        elif (code == 1063) then (if is_day then "󰼳" else "󰖗" end)  # Patchy rain possible
        elif (code == 1150) then "󰖗"  # Patchy light drizzle
        elif (code == 1153) then "󰖗"  # Light drizzle
        elif (code == 1168) then "󰖒"  # Freezing drizzle
        elif (code == 1171) then "󰙿"  # Heavy freezing drizzle
        elif (code == 1180) then (if is_day then "󰼳" else "󰖗" end)  # Patchy light rain
        elif (code == 1240) then "󰖗"  # Light rain shower
        
        # Rain
        elif (code == 1183) then "󰖗"  # Light rain
        elif (code == 1186) then "󰖖"  # Moderate rain at times
        elif (code == 1189) then "󰖖"  # Moderate rain
        elif (code == 1192) then "󰙾"  # Heavy rain at times
        elif (code == 1195) then "󰙾"  # Heavy rain
        elif (code == 1198) then "󰙿"  # Light freezing rain
        elif (code == 1201) then "󰙾"  # Moderate/heavy freezing rain
        elif (code == 1243) then "󰙾"  # Moderate/heavy rain shower
        elif (code == 1246) then "󰙾"  # Torrential rain shower
        
        # Snow/Sleet (includes rain+snow mix)
        elif (code == 1066) then "󰖘"  # Patchy snow possible
        elif (code == 1069) then "󰙿"  # Patchy sleet (rain+snow mix)
        elif (code == 1072) then "󰙿"  # Patchy freezing drizzle
        elif (code == 1114) then "󰜗"  # Blowing snow
        elif (code == 1117) then "󰜗"  # Blizzard
        elif (code == 1204) then "󰙿"  # Light sleet (light rain+snow)
        elif (code == 1207) then "󰙿"  # Moderate/heavy sleet (heavy rain+snow)
        elif (code == 1210) then "󰜗"  # Patchy light snow
        elif (code == 1213) then "󰜗"  # Light snow
        elif (code == 1216) then "󰜗"  # Patchy moderate snow
        elif (code == 1219) then "󰜗"  # Moderate snow
        elif (code == 1222) then "󰜗"  # Patchy heavy snow
        elif (code == 1225) then "󰜗"  # Heavy snow
        elif (code == 1237) then "󰖘"  # Ice pellets
        elif (code == 1249) then "󰙿"  # Light sleet showers
        elif (code == 1252) then "󰼶"  # Moderate/heavy sleet showers
        elif (code == 1255) then "󰙿"  # Light snow showers
        elif (code == 1258) then "󰼶"  # Moderate/heavy snow showers
        elif (code == 1261) then "󰖘"  # Light ice pellet showers
        elif (code == 1264) then "󰼶"  # Moderate/heavy ice pellet showers
        
        # Thunderstorms (with rain or snow)
        elif (code == 1087) then "󰖓"  # Thundery outbreaks possible
        elif (code == 1273) then (if is_day then "󰼲" else "󰖓" end)  # Light rain + thunder
        elif (code == 1276) then "󰖖"  # Moderate/heavy rain + thunder
        elif (code == 1279) then "󰼶"  # Light snow + thunder
        elif (code == 1282) then "󰙿"  # Moderate/heavy snow + thunder
        
        # Default
        else "" end;
    
    .current as $current |
    .location as $location |
    
    # Determine day/night based on system time (6 AM to 6 PM)
    (($hour >= 6 and $hour < 19)) as $is_day_system |
    
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
        "tooltip": " <b>\($current.condition.text)</b>\n Location: \($display_loc)\n󰔐 Feels like: \($data.feel | round)\($data.unit)\n󰖌 Humidity: \($current.humidity)%\n󰖝 Wind: \($data.speed)\n󰈈 Visibility: \($data.vis)\n-------------------\nScroll-Up: °C\nScroll-Down: °F\nClick: Weather Menu",
        "class": "weather",
        "alt": $current.condition.text
    }
' <<< "$WEATHER_DATA"
