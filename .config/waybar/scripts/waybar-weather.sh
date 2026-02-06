#!/bin/bash

# -----------------------------------------------------------------------------
# Configuration & Constants
# -----------------------------------------------------------------------------
UNIT_STATE_FILE="/tmp/waybar-weather-unit"
WEATHER_CACHE_FILE="/tmp/waybar-weather-cache.json"
LOCATION_CACHE_FILE="/tmp/waybar-weather-location"

# Weather updates every 30 min
WEATHER_MAX_AGE=1800 
# Location updates every 60 min (checks if you've traveled)
LOCATION_MAX_AGE=3600

# -----------------------------------------------------------------------------
# 1. Auto-Detect Location (refreshes if cache is old)
# -----------------------------------------------------------------------------
# Check if location cache exists and is old
if [ -f "$LOCATION_CACHE_FILE" ]; then
    current_time=$(date +%s)
    file_mod_time=$(stat -c %Y "$LOCATION_CACHE_FILE")
    if [ $((current_time - file_mod_time)) -ge "$LOCATION_MAX_AGE" ]; then
        # Cache is old, remove it to trigger refresh
        rm "$LOCATION_CACHE_FILE"
    fi
fi

# If cache is missing (or deleted above), fetch new location
if [ ! -s "$LOCATION_CACHE_FILE" ]; then
    # Download to temp file first to avoid corruption
    curl -s https://ipinfo.io/city > "${LOCATION_CACHE_FILE}.tmp"
    
    # If successful and not empty, save it. Otherwise keep old/empty to prevent errors.
    if [ -s "${LOCATION_CACHE_FILE}.tmp" ]; then
        cat "${LOCATION_CACHE_FILE}.tmp" | tr -d '\n' > "$LOCATION_CACHE_FILE"
        rm "${LOCATION_CACHE_FILE}.tmp"
    fi
fi

# Read location, fallback to empty (auto) if file is empty
LOCATION=$(cat "$LOCATION_CACHE_FILE" 2>/dev/null)
if [ -z "$LOCATION" ]; then
    LOCATION="" # wttr.in will fallback to IP detection if this is empty
fi

# -----------------------------------------------------------------------------
# 2. Fetch Weather Data (if cache expired)
# -----------------------------------------------------------------------------
CACHE_WAS_MISSING=false
if [ ! -f "$WEATHER_CACHE_FILE" ]; then
    CACHE_WAS_MISSING=true
fi

sleep 5

fetch_weather() {
if [ ! -f "$WEATHER_CACHE_FILE" ] || [ "$(( $(date +%s) - $(stat -c %Y "$WEATHER_CACHE_FILE") ))" -ge "$WEATHER_MAX_AGE" ]; then
    # Fetch weather for the detected location
    SAFE_LOCATION=$(echo "$LOCATION" | sed 's/ /+/g')
    
    curl -s -f --max-time 10 "https://wttr.in/${SAFE_LOCATION}?format=j1" > "${WEATHER_CACHE_FILE}.tmp"
    
    # Verify JSON before overwriting the main cache
    if [ $? -eq 0 ] && jq -e . "${WEATHER_CACHE_FILE}.tmp" >/dev/null 2>&1; then
        mv "${WEATHER_CACHE_FILE}.tmp" "$WEATHER_CACHE_FILE"
        
        # If this was initial fetch, update waybar immediately
        if [ "$CACHE_WAS_MISSING" = true ]; then
            pkill -SIGRTMIN+8 waybar
        fi
    else
        rm -f "${WEATHER_CACHE_FILE}.tmp"
    fi
fi
}

fetch_weather

if [ ! -f "$WEATHER_CACHE_FILE" ]; then
   sleep 15
   fetch_weather
fi

# -----------------------------------------------------------------------------
# 3. Validation
# -----------------------------------------------------------------------------
#if [ ! -s "$WEATHER_CACHE_FILE" ]; then
#    echo "{\"text\": \"...\", \"tooltip\": \"Weather unavailable\"}"
#    exit 0
#fi

# -----------------------------------------------------------------------------
# 4. Process Data with Day/Night Logic
# -----------------------------------------------------------------------------
# If cache still doesn't exist, show placeholder (will retry in next interval)
if [ ! -f "$WEATHER_CACHE_FILE" ]; then
    echo '{"text": "...", "tooltip": "Loading weather data..."}'
fi

CURRENT_UNIT=$(cat "$UNIT_STATE_FILE" 2>/dev/null || echo "metric")
CURRENT_TIME=$(date +"%H:%M")

jq --arg unit "$CURRENT_UNIT" --arg time "$CURRENT_TIME" -rc '
    def to_minutes(t):
        if (t | contains("M")) then
            (t | split(" ")[0] | split(":")[0] | tonumber) as $h |
            (t | split(" ")[0] | split(":")[1] | tonumber) as $m |
            (t | split(" ")[1]) as $ampm |
            if ($ampm == "PM" and $h != 12) then ($h + 12) * 60 + $m
            elif ($ampm == "AM" and $h == 12) then $m
            else $h * 60 + $m
            end
        else
            (t | split(":")[0] | tonumber) * 60 + (t | split(":")[1] | tonumber)
        end;

    def get_icon(code; is_night):
        if (code == "113") then (if is_night then "🌙" else "☀️" end)
        elif (code == "116") then (if is_night then "☁️" else "⛅" end)
        elif (code == "119") then "☁️"
        elif (code == "122") then "☁️"
        elif (code == "143") then "🌫️"
        elif (code == "248") then "🌫️"
        elif (code == "260") then "🌫️"
        elif (code == "296") then "🌧️"
        elif (code == "308") then "🌧️"
        elif (code == "353") then "🌧️"
        elif (code == "356") then "🌧️"
        elif (code == "359") then "🌧️"
        elif (code == "386") then "⛈️"
        elif (code == "389") then "⛈️"
        elif (code == "392") then "⛈️"
        elif (code == "395") then "⛈️"
        elif (code == "176") then "🌦️"
        elif (code == "263") then "🌦️"
        elif (code == "266") then "🌦️"
        elif (code == "293") then "🌦️"
        elif (code == "299") then "🌦️"
        elif (code == "302") then "🌦️"
        elif (code == "305") then "🌦️"
        elif (code == "311") then "🌧️"
        elif (code == "314") then "🌧️"
        elif (code == "317") then "🌧️"
        elif (code == "320") then "🌨️"
        elif (code == "323") then "🌨️"
        elif (code == "326") then "🌨️"
        elif (code == "329") then "❄️"
        elif (code == "332") then "❄️"
        elif (code == "335") then "❄️"
        elif (code == "338") then "❄️"
        elif (code == "350") then "🌨️"
        elif (code == "362") then "🌨️"
        elif (code == "365") then "🌨️"
        elif (code == "368") then "🌨️"
        elif (code == "371") then "❄️"
        elif (code == "374") then "🌨️"
        elif (code == "377") then "🌨️"
        else "" end;

    .current_condition[0] as $current |
    .nearest_area[0] as $area |
    .weather[0].astronomy[0] as $astro |
    
    (to_minutes($time)) as $now_mins |
    (to_minutes($astro.sunrise)) as $sunrise_mins |
    (to_minutes($astro.sunset)) as $sunset_mins |
    ($now_mins < $sunrise_mins or $now_mins > $sunset_mins) as $is_night |

    (if $unit == "metric" then
        { temp: $current.temp_C, feel: $current.FeelsLikeC, unit: "°C", speed: $current.windspeedKmph, wind: "km/h" }
    else
        { temp: $current.temp_F, feel: $current.FeelsLikeF, unit: "°F", speed: $current.windspeedMiles, wind: "mph" }
    end) as $data |

    {
        "text": "\($data.temp)\($data.unit) \(get_icon($current.weatherCode; $is_night))",
        "tooltip": "<b>\($current.weatherDesc[0].value)</b>\nLocation: \($area.areaName[0].value)\nSunrise: \($astro.sunrise)\nSunset: \($astro.sunset)\nFeels like: \($data.feel)\($data.unit)\nHumidity: \($current.humidity)%\nWind: \($data.speed) \($data.wind)\n-------------------\nScroll-Up : °C\nScroll-Down : °F\nClick : Weather-App",
        "class": "weather",
        "alt": $current.weatherDesc[0].value
    }
' "$WEATHER_CACHE_FILE"
