#!/bin/bash

# Waybar Weather Module - Astal Integration
# Uses WeatherAPI.com with auto-location via ipinfo

WEATHER_API_KEY="bd6beb7dd25a42ec9b295232250504"
UNIT_STATE_FILE="/tmp/waybar-weather-unit"
WEATHER_CACHE_FILE="/tmp/astal-weather-cache.json"
LOCATION_CACHE_FILE="/tmp/waybar-weather-location"
CACHE_MAX_AGE=600  # 10 minutes

# Get current unit
CURRENT_UNIT=$(cat "$UNIT_STATE_FILE" 2>/dev/null || echo "metric")

# Get location from cache or fetch new
get_location() {
    if [ -f "$LOCATION_CACHE_FILE" ]; then
        CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCATION_CACHE_FILE") ))
        if [ $CACHE_AGE -lt 3600 ]; then
            cat "$LOCATION_CACHE_FILE"
            return
        fi
    fi
    
    # Fetch new location
    LOCATION=$(curl -s https://ipinfo.io/city)
    if [ -n "$LOCATION" ]; then
        echo "$LOCATION" > "$LOCATION_CACHE_FILE"
        echo "$LOCATION"
    else
        echo "auto"
    fi
}

LOCATION=$(get_location)

# Check cache freshness
if [ -f "$WEATHER_CACHE_FILE" ]; then
    CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$WEATHER_CACHE_FILE") ))
    if [ $CACHE_AGE -lt $CACHE_MAX_AGE ]; then
        # Use cached data
        WEATHER_DATA=$(cat "$WEATHER_CACHE_FILE")
    else
        # Fetch new data
        WEATHER_DATA=$(curl -s "https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${LOCATION}&days=3&aqi=no&alerts=no")
        echo "$WEATHER_DATA" > "$WEATHER_CACHE_FILE"
    fi
else
    # Fetch new data
    WEATHER_DATA=$(curl -s "https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${LOCATION}&days=3&aqi=no&alerts=no")
    echo "$WEATHER_DATA" > "$WEATHER_CACHE_FILE"
fi

# Parse weather data with jq
jq --arg unit "$CURRENT_UNIT" -rc '
    # Weather icon mapping
    def get_icon(code; is_day):
        if (code == 1000) then (if is_day then "☀️" else "🌙" end)
        elif (code == 1003) then (if is_day then "⛅" else "☁️" end)
        elif (code == 1006 or code == 1009) then "☁️"
        elif (code == 1030 or code == 1135 or code == 1147) then "🌫️"
        elif (code == 1063 or code == 1150 or code == 1153 or code == 1180 or code == 1240) then "🌦️"
        elif (code >= 1180 and code <= 1201) then "🌧️"
        elif (code >= 1204 and code <= 1237) then "🌨️"
        elif (code >= 1210 and code <= 1225) then "❄️"
        elif (code == 1066 or code == 1069 or code == 1072) then "🌨️"
        elif (code >= 1273) then "⛈️"
        else "🌡️" end;
    
    .current as $current |
    .location as $location |
    
    (if $unit == "metric" then
        { temp: $current.temp_c, feel: $current.feelslike_c, unit: "°C", speed: "\($current.wind_kph) km/h" }
    else
        { temp: $current.temp_f, feel: $current.feelslike_f, unit: "°F", speed: "\($current.wind_mph) mph" }
    end) as $data |
    
    {
        "text": "\($data.temp | round)\($data.unit) \(get_icon($current.condition.code; $current.is_day))",
        "tooltip": "<b>\($current.condition.text)</b>\nLocation: \($location.name), \($location.country)\nFeels like: \($data.feel | round)\($data.unit)\nHumidity: \($current.humidity)%\nWind: \($data.speed)\n-------------------\nScroll-Up: °C\nScroll-Down: °F\nClick: Weather Menu",
        "class": "weather",
        "alt": $current.condition.text
    }
' <<< "$WEATHER_DATA"
