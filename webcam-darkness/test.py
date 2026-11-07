import cv2
import numpy as np
import mediapipe as mp

from mediapipe.tasks import python
from mediapipe.tasks.python import vision

print("MediaPipe:", mp.__version__)
print("OpenCV:", cv2.__version__)
print("NumPy:", np.__version__)

options = vision.ImageSegmenterOptions(
    base_options=python.BaseOptions(
        model_asset_path="selfie_segmenter.tflite"
    ),
    running_mode=vision.RunningMode.IMAGE,
    output_category_mask=True,
    output_confidence_masks=False,
)

with vision.ImageSegmenter.create_from_options(options):
    print("Success: the Image Segmenter model loaded.")


