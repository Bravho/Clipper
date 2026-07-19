"use client";

import { useState } from "react";
import {
  Camera,
  CameraResultType,
  CameraSource,
  CameraDirection,
} from "@capacitor/camera";
import { isNativeMobile } from "@/lib/mobile/platform";
import { Button } from "@/components/ui/Button";

interface NativeMediaPickerProps {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function NativeMediaPicker({
  disabled = false,
  onFiles,
}: NativeMediaPickerProps) {
  const [busy, setBusy] = useState<"camera" | "library" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isNativeMobile()) return null;

  const selectPhoto = async (source: CameraSource) => {
    setBusy(source === CameraSource.Camera ? "camera" : "library");
    setError(null);
    try {
      const photo = await Camera.getPhoto({
        source,
        resultType: CameraResultType.Uri,
        direction: CameraDirection.Rear,
        quality: 90,
        correctOrientation: true,
        saveToGallery: false,
        allowEditing: false,
      });

      if (!photo.webPath) throw new Error("Camera did not return a media file.");
      const response = await fetch(photo.webPath);
      if (!response.ok) throw new Error("Unable to read the selected photo.");
      const blob = await response.blob();
      const mimeType = blob.type || `image/${photo.format || "jpeg"}`;
      const file = new File(
        [blob],
        `rclipper-${Date.now()}.${extensionForMime(mimeType)}`,
        { type: mimeType, lastModified: Date.now() }
      );
      onFiles([file]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // Capacitor uses platform-specific cancellation messages. Cancellation is
      // not an error and should leave the form unchanged.
      if (!/cancel|canceled|cancelled/i.test(message)) {
        setError(
          "ไม่สามารถเปิดกล้องหรือคลังรูปภาพได้ กรุณาตรวจสอบสิทธิ์ในการตั้งค่าอุปกรณ์"
        );
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="mb-3 text-sm font-medium text-slate-800">
        เพิ่มสื่อจากโทรศัพท์
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy !== null}
          loading={busy === "camera"}
          onClick={() => void selectPhoto(CameraSource.Camera)}
        >
          ถ่ายรูป
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy !== null}
          loading={busy === "library"}
          onClick={() => void selectPhoto(CameraSource.Photos)}
        >
          เลือกรูปจากเครื่อง
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        วิดีโอสามารถเลือกได้จากปุ่มเลือกไฟล์ด้านล่าง
      </p>
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

