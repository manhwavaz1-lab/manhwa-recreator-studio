import unittest

from fastapi import HTTPException

from main import validate_youtube_url


class YouTubeUrlValidationTests(unittest.TestCase):
    def test_accepts_public_watch_url(self):
        validate_youtube_url("https://www.youtube.com/watch?v=abc123")

    def test_accepts_unlisted_short_link(self):
        validate_youtube_url("https://youtu.be/abc123")

    def test_rejects_non_youtube_host(self):
        with self.assertRaises(HTTPException):
            validate_youtube_url("https://example.com/watch?v=abc123")

    def test_rejects_playlist(self):
        with self.assertRaises(HTTPException):
            validate_youtube_url("https://www.youtube.com/playlist?list=PL123")

    def test_rejects_http_scheme(self):
        with self.assertRaises(HTTPException):
            validate_youtube_url("http://www.youtube.com/watch?v=abc123")


if __name__ == "__main__":
    unittest.main()
