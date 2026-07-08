// =============================================
// SKATE — Social Media Uploader
// =============================================

import fs from 'fs';
import path from 'path';
import { getYouTubeToken, getInstagramToken } from './auth.js';

// ─── Template Variable Substitution ──────────

/**
 * Replace template variables in user-configured text
 * Supports: {title}, {description}, {hashtags}, {caption}, {clipNum}
 */
function applyTemplate(template, clip, clipIndex) {
  if (!template) return '';
  return template
    .replace(/\{title\}/gi, clip.title || '')
    .replace(/\{description\}/gi, clip.description || '')
    .replace(/\{hashtags\}/gi, clip.hashtags || '')
    .replace(/\{caption\}/gi, clip.caption || '')
    .replace(/\{clipNum\}/gi, String(clipIndex + 1));
}

// ─── YouTube Shorts Upload ───────────────────

/**
 * Upload a video to YouTube as a Short
 * Uses YouTube Data API v3 resumable upload
 *
 * @param {string} filePath - Absolute path to the .mp4 file
 * @param {Object} metadata - { title, description, tags, audience, visibility }
 * @param {Object} clip - Clip data with AI-generated social content
 * @param {number} clipIndex - Clip index for template substitution
 * @param {Function} onProgress - Progress callback
 * @returns {Object} { success, videoId, url, error }
 */
export async function uploadToYouTube(filePath, metadata, clip, clipIndex, onProgress) {
  const accessToken = await getYouTubeToken();
  if (!accessToken) {
    return { success: false, error: 'YouTube not connected or token expired' };
  }

  try {
    // Apply templates
    let title = applyTemplate(metadata.title, clip, clipIndex) || clip.title || `Clip ${clipIndex + 1}`;
    let description = applyTemplate(metadata.description, clip, clipIndex) || clip.description || '';
    const tagsStr = applyTemplate(metadata.tags, clip, clipIndex) || '';
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);

    // Ensure #Shorts is in the title for YouTube Shorts
    if (!title.toLowerCase().includes('#shorts')) {
      title = `${title} #Shorts`;
    }

    // Ensure title is within limits
    title = title.slice(0, 100);
    description = description.slice(0, 5000);

    const madeForKids = metadata.audience === 'kids';
    const privacyStatus = metadata.visibility || 'public';

    // Step 1: Initialize resumable upload
    onProgress?.(`📤 Initializing YouTube upload for clip ${clipIndex + 1}...`);

    const videoMetadata = {
      snippet: {
        title,
        description,
        tags: tags.length > 0 ? tags : ['shorts', 'viral'],
        categoryId: '22', // People & Blogs
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: madeForKids,
      },
    };

    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': fs.statSync(filePath).size.toString(),
        },
        body: JSON.stringify(videoMetadata),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`YouTube upload init failed: ${err}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('No upload URL returned from YouTube');

    // Step 2: Upload the video file
    onProgress?.(`⬆️  Uploading video to YouTube...`);

    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.length;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize.toString(),
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`YouTube upload failed: ${err}`);
    }

    const uploadData = await uploadRes.json();
    const videoId = uploadData.id;

    onProgress?.(`✅ YouTube upload complete! Video ID: ${videoId}`);

    return {
      success: true,
      videoId,
      url: `https://youtube.com/shorts/${videoId}`,
    };
  } catch (err) {
    onProgress?.(`❌ YouTube upload failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Instagram Reels Upload ──────────────────

/**
 * Upload a video to Instagram as a Reel
 * Uses Instagram Graph API media container workflow
 *
 * @param {string} fileUrl - Public URL of the video (must be accessible from Meta servers)
 * @param {Object} metadata - { caption, hashtags }
 * @param {Object} clip - Clip data with AI-generated social content
 * @param {number} clipIndex - Clip index for template substitution
 * @param {Function} onProgress - Progress callback
 * @returns {Object} { success, mediaId, url, error }
 */
export async function uploadToInstagram(fileUrl, metadata, clip, clipIndex, onProgress) {
  const igAuth = getInstagramToken();
  if (!igAuth) {
    return { success: false, error: 'Instagram not connected or token expired' };
  }

  const { accessToken, igUserId } = igAuth;

  try {
    // Build caption from template
    let caption = applyTemplate(metadata.caption, clip, clipIndex) || clip.caption || '';
    const extraHashtags = applyTemplate(metadata.hashtags, clip, clipIndex) || '';

    if (extraHashtags) {
      caption = `${caption}\n\n${extraHashtags}`;
    }

    // Add clip hashtags if not already present
    if (clip.hashtags && !caption.includes(clip.hashtags)) {
      caption = `${caption}\n${clip.hashtags}`;
    }

    caption = caption.slice(0, 2200); // Instagram caption limit

    // Step 1: Create media container
    onProgress?.(`📤 Creating Instagram Reel container for clip ${clipIndex + 1}...`);

    const containerUrl = `https://graph.facebook.com/v21.0/${igUserId}/media`;
    const containerRes = await fetch(containerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'REELS',
        video_url: fileUrl,
        caption,
        access_token: accessToken,
      }),
    });

    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`IG container creation failed: ${err}`);
    }

    const containerData = await containerRes.json();
    const containerId = containerData.id;

    // Step 2: Poll for container to be ready
    onProgress?.(`⏳ Waiting for Instagram to process video...`);

    let status = 'IN_PROGRESS';
    let attempts = 0;
    const maxAttempts = 60; // ~5 minutes with 5s intervals

    while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

      const statusRes = await fetch(
        `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${accessToken}`
      );

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        status = statusData.status_code;

        if (status === 'ERROR') {
          throw new Error('Instagram media processing failed');
        }
      }

      if (attempts % 6 === 0) {
        onProgress?.(`   Still processing... (${attempts * 5}s elapsed)`);
      }
    }

    if (status !== 'FINISHED') {
      throw new Error(`Instagram processing timeout after ${maxAttempts * 5}s`);
    }

    // Step 3: Publish the container
    onProgress?.(`📱 Publishing Reel to Instagram...`);

    const publishRes = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      }
    );

    if (!publishRes.ok) {
      const err = await publishRes.text();
      throw new Error(`IG publish failed: ${err}`);
    }

    const publishData = await publishRes.json();
    const mediaId = publishData.id;

    onProgress?.(`✅ Instagram Reel published! Media ID: ${mediaId}`);

    return {
      success: true,
      mediaId,
      url: `https://www.instagram.com/reel/${mediaId}/`,
    };
  } catch (err) {
    onProgress?.(`❌ Instagram upload failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Publish Clips to All Platforms ──────────

/**
 * Publish multiple clips to connected platforms
 *
 * @param {Array} clips - Array of clip data with social content
 * @param {Array} files - Array of file paths/URLs for rendered clips
 * @param {Object} workflow - { instagram: { caption, hashtags }, youtube: { title, description, tags, audience, visibility } }
 * @param {string} rootDir - Project root directory
 * @param {Function} broadcast - WebSocket broadcast function
 * @returns {Object} { results: [...], summary }
 */
export async function publishClips(clips, files, workflow, rootDir, broadcast) {
  const results = [];
  const totalClips = clips.length;
  let successCount = 0;

  broadcast({ type: 'log', level: 'info', msg: `📤 Starting publish: ${totalClips} clips` });

  for (let i = 0; i < totalClips; i++) {
    const clip = clips[i];
    const fileRelativePath = files[i];

    broadcast({
      type: 'publish_progress',
      clipIndex: i,
      total: totalClips,
      status: 'uploading',
    });

    const clipResult = { clipIndex: i, youtube: null, instagram: null };

    // ─── YouTube Upload ─────────────────────
    if (workflow.youtube) {
      const filePath = path.join(rootDir, fileRelativePath.replace(/^\//, ''));

      if (fs.existsSync(filePath)) {
        broadcast({ type: 'log', level: 'info', msg: `📺 Uploading clip ${i + 1}/${totalClips} to YouTube...` });

        clipResult.youtube = await uploadToYouTube(
          filePath,
          workflow.youtube,
          clip,
          i,
          (msg) => broadcast({ type: 'log', level: 'info', msg: `   ${msg}` })
        );

        if (clipResult.youtube.success) successCount++;
      } else {
        clipResult.youtube = { success: false, error: `File not found: ${filePath}` };
        broadcast({ type: 'log', level: 'error', msg: `   ❌ File not found: ${filePath}` });
      }
    }

    // ─── Instagram Upload ───────────────────
    if (workflow.instagram) {
      // Instagram requires a publicly accessible URL
      // For local files, we'll need the server URL
      const serverUrl = `http://localhost:${process.env.PORT || 3000}`;
      const publicUrl = `${serverUrl}${fileRelativePath}`;

      broadcast({ type: 'log', level: 'info', msg: `📱 Uploading clip ${i + 1}/${totalClips} to Instagram...` });

      // Note: Instagram Graph API requires the video to be at a publicly accessible URL
      // For local development, this won't work unless using a tunnel (ngrok, etc.)
      clipResult.instagram = await uploadToInstagram(
        publicUrl,
        workflow.instagram,
        clip,
        i,
        (msg) => broadcast({ type: 'log', level: 'info', msg: `   ${msg}` })
      );

      if (clipResult.instagram.success) successCount++;
    }

    results.push(clipResult);

    broadcast({
      type: 'publish_progress',
      clipIndex: i,
      total: totalClips,
      status: (clipResult.youtube?.success || clipResult.instagram?.success) ? 'done' : 'error',
      result: clipResult,
    });
  }

  const summary = {
    total: totalClips,
    success: successCount,
    failed: (workflow.youtube ? totalClips : 0) + (workflow.instagram ? totalClips : 0) - successCount,
  };

  broadcast({ type: 'log', level: 'success', msg: `✅ Publishing complete: ${successCount} successful uploads` });

  return { results, summary };
}
