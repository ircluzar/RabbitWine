@echo off
setlocal enabledelayedexpansion

:: --- Configuration ---
set "FFMPEG_PATH=ffmpeg" :: Assuming ffmpeg is in your PATH.
                           :: If not, specify the full path, e.g., "C:\path\to\ffmpeg\bin\ffmpeg.exe"
set "INPUT_EXTENSION=.mp3"
set "OUTPUT_EXTENSION=.m4a"
set "AAC_BITRATE=69k"     :: Common bitrates: 128k, 192k, 256k, 320k. Higher = better quality, larger file.
set "AAC_ENCODER=aac"      :: Use 'aac' (default FFmpeg encoder) or 'libfdk_aac' if available for better quality
                           :: (libfdk_aac usually requires a custom FFmpeg build and is not included by default).

echo.
echo Starting MP3 to AAC conversion...
echo Output Bitrate: %AAC_BITRATE%
echo Output Extension: %OUTPUT_EXTENSION%
echo.

:: Loop through all MP3 files in the current directory
for %%f in (*%INPUT_EXTENSION%) do (
    set "INPUT_FILE=%%f"
    set "FILENAME_NO_EXT=%%~nf"
    set "OUTPUT_FILE=!FILENAME_NO_EXT!%OUTPUT_EXTENSION%"

    echo Converting "!INPUT_FILE!" to "!OUTPUT_FILE!"...

    :: Check if the output file already exists
    if exist "!OUTPUT_FILE!" (
        echo Warning: "!OUTPUT_FILE!" already exists. Skipping conversion for this file.
    ) else (
        :: Execute FFmpeg command
        :: ADDED -vn to ignore any video streams
        "%FFMPEG_PATH%" -i "!INPUT_FILE!" -vn -c:a %AAC_ENCODER% -b:a %AAC_BITRATE% -map_metadata 0 -metadata:s:a:0 title="!FILENAME_NO_EXT!" "!OUTPUT_FILE!"
        if errorlevel 1 (
            echo Error converting "!INPUT_FILE!". See FFmpeg output above.
        ) else (
            echo Successfully converted "!INPUT_FILE!".
        )
    )
    echo.
)

echo All MP3 files processed.
pause
endlocal