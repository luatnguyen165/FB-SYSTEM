import re
import json
import requests
import random
import string
from typing import Dict, Any, Optional
import sys
import io

# Fix encoding trên Windows (UTF-8 output)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def generate_random_cookie_value():
    chars = string.ascii_letters + string.digits + "-_"
    return ''.join(random.choices(chars, k=24))

class FacebookDownloader:
    def __init__(self, cookie: Optional[str] = None, useragent: Optional[str] = None):
        self.headers = {
            "sec-fetch-user": "?1",
            "sec-ch-ua-mobile": "?0",
            "sec-fetch-site": "none",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "cache-control": "max-age=0",
            "authority": "www.facebook.com",
            "upgrade-insecure-requests": "1",
            "accept-language": "en-GB,en;q=0.9,tr-TR;q=0.8,tr;q=0.7,en-US;q=0.6",
            "sec-ch-ua": '"Google Chrome";v="89", "Chromium";v="89", ";Not A Brand";v="99"',
            "user-agent": useragent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.114 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        }
        
        default_cookie = f"sb={generate_random_cookie_value()}; datr={generate_random_cookie_value()};"
        self.headers['cookie'] = cookie or default_cookie

    def _parse_string(self, string: str) -> str:
        try:
            return json.loads(f'{{"text": "{string}"}}')["text"]
        except Exception:
            return string

    def _get_file_size(self, url: str) -> Optional[int]:
        if not url:
            return None
        try:
            res = requests.head(url, timeout=5)
            if 'content-length' in res.headers:
                return int(res.headers['content-length'])
        except Exception:
            pass
        return None

    def get_fb_video_info(self, video_url: str) -> Dict[str, Any]:
        if not video_url or not video_url.strip():
            raise ValueError("Please specify the Facebook URL")
        
        if not any(domain in video_url for domain in ["facebook.com", "fb.watch"]):
            raise ValueError("Please enter a valid Facebook URL")

        try:
            response = requests.get(video_url, headers=self.headers, timeout=15)
            response.raise_for_status()
            data = response.text
        except requests.RequestException as e:
            raise RuntimeError(f"Unable to fetch video information. Request Error: {e}")

        # Replace HTML entities
        data = data.replace('&quot;', '"').replace('&amp;', '&')

        # SD URL Matching
        sd_match = (
            re.search(r'"browser_native_sd_url":"(.*?)"', data) or
            re.search(r'"playable_url":"(.*?)"', data) or
            re.search(r'sd_src\s*:\s*"([^"]*)"', data) or
            re.search(r'(?<="src":")[^"]*(https:\/\/[^"]*)', data)
        )
        
        # HD URL Matching
        hd_match = (
            re.search(r'"browser_native_hd_url":"(.*?)"', data) or
            re.search(r'"playable_url_quality_hd":"(.*?)"', data) or
            re.search(r'hd_src\s*:\s*"([^"]*)"', data)
        )
        
        # Title Matching
        title_match = re.search(r'<meta\s+name="description"\s+content="(.*?)"', data)
        if not title_match:
            title_match = re.search(r'<title>(.*?)<\/title>', data)
            
        # Thumbnail Matching
        thumb_match = re.search(r'"preferred_thumbnail":{"image":{"uri":"(.*?)"', data)
        
        # Duration Matching
        duration_matches = re.findall(r'"playable_duration_in_ms":([0-9]+)', data)
        
        if sd_match and sd_match.group(1):
            duration_ms = int(duration_matches[0]) if duration_matches else 0
            
            sd_url = self._parse_string(sd_match.group(1))
            hd_url = self._parse_string(hd_match.group(1)) if hd_match and hd_match.group(1) else ""
            
            result = {
                "url": video_url,
                "duration_ms": duration_ms,
                "sd": sd_url,
                "hd": hd_url,
                "sd_size": self._get_file_size(sd_url),
                "hd_size": self._get_file_size(hd_url) if hd_url else None,
                "title": self._parse_string(title_match.group(1)) if title_match and title_match.group(1) else "",
                "thumbnail": self._parse_string(thumb_match.group(1)) if thumb_match and thumb_match.group(1) else ""
            }
            return result
        else:
            raise RuntimeError("Unable to fetch video information at this time. Facebook might have blocked the request or changed their HTML structure. Contact me if the problem continue.Telegram: @inception00007")

def format_size(bytes_size):
    if not bytes_size:
        return "N/A"
    return f"{bytes_size / (1024 * 1024):.1f} MB"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        url = sys.argv[1]
    else:
        print("Facebook Direct Scraper API")
        url = input("Enter Facebook Video URL: ").strip()

    if url:
        try:
            print(f"\nFetching data for: {url}")
            downloader = FacebookDownloader()
            info = downloader.get_fb_video_info(url)
            
            print("\n[SUCCESS] Video Info Found!")
            print("-" * 50)
            print(f"Title:     {info['title']}")
            print(f"Duration:  {info['duration_ms']} ms")
            print(f"Thumbnail: {info['thumbnail']}")
            print("-" * 50)
            if info['hd']:
                print(f"HD Link:   {info['hd']}")
                print(f"HD Size:   {format_size(info['hd_size'])}")
                print("-" * 50)
            print(f"SD Link:   {info['sd']}")
            print(f"SD Size:   {format_size(info['sd_size'])}")
            
        except Exception as e:
            print(f"\n[ERROR] {e}")
