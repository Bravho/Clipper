"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/client";

type Coordinates = { latitude: number; longitude: number };

interface GoogleMapLocationPickerProps {
  open: boolean;
  placeName?: string;
  initialCoordinates?: Coordinates | null;
  onConfirm: (coordinates: Coordinates) => void;
  onClose: () => void;
}

interface GoogleLatLng {
  lat(): number;
  lng(): number;
}

interface GoogleMapMouseEvent {
  latLng?: GoogleLatLng | null;
}

interface GoogleMapInstance {
  addListener(eventName: "click", handler: (event: GoogleMapMouseEvent) => void): void;
  panTo(position: { lat: number; lng: number }): void;
  setCenter(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
}

interface GoogleAdvancedMarker {
  position?: { lat: number; lng: number } | GoogleLatLng | null;
  map: GoogleMapInstance | null;
  addListener(eventName: "dragend", handler: () => void): void;
}

interface GoogleGeocoderResult {
  geometry: { location: GoogleLatLng };
}

interface GoogleMapsApi {
  Map: new (
    element: HTMLElement,
    options: {
      center: { lat: number; lng: number };
      zoom: number;
      mapId?: string;
      streetViewControl: boolean;
      mapTypeControl: boolean;
      fullscreenControl: boolean;
    }
  ) => GoogleMapInstance;
  marker: {
    AdvancedMarkerElement: new (options: {
      map: GoogleMapInstance;
      position: { lat: number; lng: number };
      gmpDraggable: boolean;
      title: string;
    }) => GoogleAdvancedMarker;
  };
  Geocoder: new () => {
    geocode(
      request: { address: string; region?: string },
      callback: (
        results: GoogleGeocoderResult[] | null,
        status: string
      ) => void
    ): void;
  };
}

declare global {
  interface Window {
    google?: { maps: GoogleMapsApi };
    __rclipperGoogleMapsReady?: () => void;
  }
}

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (googleMapsPromise) return googleMapsPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return Promise.reject(
      new Error("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_GOOGLE_MAPS_API_KEY")
    );
  }

  googleMapsPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    window.__rclipperGoogleMapsReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps โหลดไม่สำเร็จ"));
    };

    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      "&libraries=marker&v=weekly&callback=__rclipperGoogleMapsReady";
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("ไม่สามารถเชื่อมต่อ Google Maps ได้"));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

function normalizeMarkerPosition(
  position: GoogleAdvancedMarker["position"]
): Coordinates | null {
  if (!position) return null;
  const latitude = position.lat;
  const longitude = position.lng;
  if (typeof latitude === "function" && typeof longitude === "function") {
    return { latitude: latitude(), longitude: longitude() };
  }
  if (typeof latitude === "number" && typeof longitude === "number") {
    return { latitude, longitude };
  }
  return null;
}

const BANGKOK = { latitude: 13.756331, longitude: 100.501762 };

export function GoogleMapLocationPicker({
  open,
  placeName,
  initialCoordinates,
  onConfirm,
  onClose,
}: GoogleMapLocationPickerProps) {
  const { t } = useI18n();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markerRef = useRef<GoogleAdvancedMarker | null>(null);
  const [selected, setSelected] = useState<Coordinates | null>(
    initialCoordinates ?? null
  );
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !mapContainerRef.current) return;
    let cancelled = false;
    setLoading(true);
    setSelected(initialCoordinates ?? null);
    setError(null);

    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapContainerRef.current) return;
        if (!mapRef.current || !markerRef.current) {
          const start = initialCoordinates ?? BANGKOK;
          const map = new maps.Map(mapContainerRef.current, {
            center: { lat: start.latitude, lng: start.longitude },
            zoom: initialCoordinates ? 16 : 11,
            mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID",
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
          });
          const marker = new maps.marker.AdvancedMarkerElement({
            map,
            position: { lat: start.latitude, lng: start.longitude },
            gmpDraggable: true,
            title: "ลากหมุดเพื่อเลือกตำแหน่ง",
          });

          map.addListener("click", (event) => {
            if (!event.latLng) return;
            const next = {
              latitude: event.latLng.lat(),
              longitude: event.latLng.lng(),
            };
            marker.position = { lat: next.latitude, lng: next.longitude };
            marker.map = map;
            setSelected(next);
          });
          marker.addListener("dragend", () => {
            setSelected(normalizeMarkerPosition(marker.position));
          });

          mapRef.current = map;
          markerRef.current = marker;
        }

        const showMarker = (coordinates: Coordinates, zoom = 16) => {
          if (cancelled || !mapRef.current || !markerRef.current) return;
          const position = {
            lat: coordinates.latitude,
            lng: coordinates.longitude,
          };
          markerRef.current.position = position;
          markerRef.current.map = mapRef.current;
          mapRef.current.setCenter(position);
          mapRef.current.setZoom(zoom);
          setSelected(coordinates);
        };

        const address = placeName?.trim();
        if (address) {
          return new Promise<void>((resolve) => {
            new maps.Geocoder().geocode(
              { address, region: "TH" },
              (results, status) => {
                if (cancelled) {
                  resolve();
                  return;
                }
                const location = results?.[0]?.geometry.location;
                if (status === "OK" && location) {
                  showMarker({
                    latitude: location.lat(),
                    longitude: location.lng(),
                  });
                } else {
                  if (initialCoordinates) {
                    showMarker(initialCoordinates);
                  } else {
                    setSelected(null);
                    if (markerRef.current) markerRef.current.map = null;
                  }
                  setError(t("map.placeNotFound"));
                }
                resolve();
              }
            );
          });
        }

        if (initialCoordinates) {
          showMarker(initialCoordinates);
        } else {
          setSelected(null);
          if (markerRef.current) markerRef.current.map = null;
          mapRef.current?.setCenter({
            lat: BANGKOK.latitude,
            lng: BANGKOK.longitude,
          });
          mapRef.current?.setZoom(11);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Google Maps โหลดไม่สำเร็จ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, initialCoordinates, placeName, t]);

  useEffect(() => {
    return () => {
      if (markerRef.current) markerRef.current.map = null;
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const next = { latitude: coords.latitude, longitude: coords.longitude };
        setSelected(next);
        if (markerRef.current && mapRef.current) {
          markerRef.current.map = mapRef.current;
        }
        if (markerRef.current) {
          markerRef.current.position = { lat: next.latitude, lng: next.longitude };
        }
        mapRef.current?.setCenter({ lat: next.latitude, lng: next.longitude });
        mapRef.current?.setZoom(17);
        setLocating(false);
      },
      () => {
        setError("ไม่สามารถเข้าถึงตำแหน่งปัจจุบันได้ กรุณาเลือกบนแผนที่");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  return (
    <div
      className={
        open
          ? "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          : "hidden"
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-picker-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 id="map-picker-title" className="text-lg font-semibold text-slate-900">
              {t("map.title")}
            </h2>
            <p className="text-sm text-slate-500">{t("map.instructions")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-slate-500 hover:bg-slate-100"
            aria-label={t("map.close")}
          >
            ×
          </button>
        </div>

        <div className="relative h-[50vh] min-h-80 overflow-hidden rounded-lg bg-slate-100">
          <div ref={mapContainerRef} className="h-full w-full" />
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-slate-100">
              <span className="text-sm text-slate-600">{t("map.loading")}</span>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <p className="mt-3 text-sm tabular-nums text-slate-600">
          {selected
            ? `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`
            : t("map.notSelected")}
        </p>

        <div className="mt-5 flex flex-wrap justify-between gap-3">
          <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={locating || loading}>
            {locating ? t("map.locating") : t("map.current")}
          </Button>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={onClose}>{t("request.cancel")}</Button>
            <Button
              type="button"
              disabled={!selected}
              onClick={() => selected && onConfirm(selected)}
            >
              {t("map.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
