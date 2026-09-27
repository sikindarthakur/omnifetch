import sys
import json
import re

def extract_instagram(url_or_shortcode):
    try:
        import instaloader
    except ImportError:
        return {"success": False, "error": "instaloader not installed"}

    # Extract shortcode from URL or string
    # Matches: /reel/SHORTCODE, /p/SHORTCODE, /tv/SHORTCODE, /share/reel/SHORTCODE, or raw SHORTCODE
    match = re.search(r'instagram\.com\/(?:[a-zA-Z0-9_\.]+\/)?(?:p|reel|tv|share\/reel|share\/p)\/([A-Za-z0-9_-]+)', url_or_shortcode)
    if not match:
        match = re.search(r'instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)', url_or_shortcode)
    shortcode = match.group(1) if match else url_or_shortcode.strip().split('/')[-1].split('?')[0]

    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False
    )

    try:
        post = instaloader.Post.from_shortcode(L.context, shortcode)
    except Exception as e:
        return {"success": False, "error": f"Failed to fetch post: {str(e)}"}

    title = (post.caption or post.title or f"Instagram Post by {post.owner_username}").strip()
    if len(title) > 120:
        title = title[:117] + "..."

    uploader = post.owner_username or "Instagram User"
    thumbnail = post.url
    is_sidecar = (post.typename == "GraphSidecar")

    items = []

    if is_sidecar:
        try:
            for idx, node in enumerate(post.get_sidecar_nodes()):
                item = {
                    "index": idx + 1,
                    "type": "video" if node.is_video else "image",
                    "url": node.video_url if node.is_video else node.display_url,
                    "thumbnail": node.display_url,
                    "ext": "mp4" if node.is_video else "jpg",
                    "title": f"{uploader}_post_{shortcode}_{idx + 1}"
                }
                items.append(item)
        except Exception as err:
            pass

    # If single video or single photo
    if not items:
        if post.is_video:
            items.append({
                "index": 1,
                "type": "video",
                "url": post.video_url,
                "thumbnail": post.url,
                "ext": "mp4",
                "title": f"{uploader}_reel_{shortcode}"
            })
        else:
            items.append({
                "index": 1,
                "type": "image",
                "url": post.url,
                "thumbnail": post.url,
                "ext": "jpg",
                "title": f"{uploader}_photo_{shortcode}"
            })

    return {
        "success": True,
        "shortcode": shortcode,
        "title": title,
        "uploader": uploader,
        "thumbnail": thumbnail,
        "viewCount": post.video_view_count if post.is_video else None,
        "likeCount": post.likes if hasattr(post, 'likes') else None,
        "isCarousel": len(items) > 1,
        "itemCount": len(items),
        "items": items,
        "platform": {
            "name": "Instagram",
            "icon": "instagram",
            "color": "#E1306C"
        }
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No URL provided"}))
        sys.exit(1)
    
    url = sys.argv[1]
    res = extract_instagram(url)
    print(json.dumps(res))
