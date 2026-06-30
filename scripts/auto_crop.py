#!/usr/bin/env python3
import sys
import cv2
import json

def get_dynamic_crops(video_path):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"Could not open video {video_path}"}))
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0: fps = 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # 9:16 target width
    target_width = int(height * (9 / 16))
    max_pan_x = (width - target_width) / 2

    # Load OpenCV Haar Cascade for face detection (fast and lightweight)
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    frame_count = 0
    sample_rate = int(fps) # Sample 1 frame per second to be fast
    
    pans = []
    
    last_pan = 0.0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        if frame_count % sample_rate == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            # Detect faces
            faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
            
            pan_val = last_pan
            if len(faces) > 0:
                # Find the largest face
                largest_face = max(faces, key=lambda rect: rect[2] * rect[3])
                x, y, w, h = largest_face
                face_center_x = x + w / 2
                
                # Convert face_center_x to pan value (-1 to 1)
                offset = face_center_x - (width / 2)
                
                if max_pan_x > 0:
                    pan_val = offset / max_pan_x
                    pan_val = max(-1.0, min(1.0, pan_val))
                
                last_pan = pan_val
            
            timestamp = frame_count / fps
            pans.append({"time": timestamp, "pan": round(pan_val, 2)})
            
        frame_count += 1
        
    cap.release()
    
    segments = []
    current_segment = None
    
    for p in pans:
        if current_segment is None:
            current_segment = {"start": p["time"], "end": p["time"], "pan": p["pan"]}
        elif abs(p["pan"] - current_segment["pan"]) < 0.1:
            current_segment["end"] = p["time"]
        else:
            segments.append(current_segment)
            current_segment = {"start": p["time"], "end": p["time"], "pan": p["pan"]}
            
    if current_segment:
        segments.append(current_segment)
        
    return segments

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: auto_crop.py <video_path>"}))
        sys.exit(1)
        
    result = get_dynamic_crops(sys.argv[1])
    print(json.dumps(result))
