import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

interface LocationPickerMapProps {
  lat: number;
  lng: number;
  radius: number;
  onChange: (lat: number, lng: number) => void;
}

const pinIcon = L.divIcon({
  className: 'sas-map-pin',
  html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#C25E00;border:3px solid #FFFFFF;transform:rotate(-45deg);box-shadow:0 3px 10px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:50%;background:#FFFFFF;transform:rotate(45deg);"></div></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({
  lat,
  lng,
  radius,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [lat, lng],
      zoom: 17,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const circle = L.circle([lat, lng], {
      radius,
      color: '#C25E00',
      fillColor: '#C25E00',
      fillOpacity: 0.16,
      weight: 2,
    }).addTo(map);

    const marker = L.marker([lat, lng], {
      draggable: true,
      icon: pinIcon,
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      circle.setLatLng(pos);
      onChangeRef.current(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      circle.setLatLng(e.latlng);
      onChangeRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    // Fix tile layout after mount
    const timer = window.setTimeout(() => map.invalidateSize(), 150);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !circleRef.current) return;
    const current = markerRef.current.getLatLng();
    const moved = Math.abs(current.lat - lat) > 0.00001 || Math.abs(current.lng - lng) > 0.00001;
    if (moved) {
      markerRef.current.setLatLng([lat, lng]);
      circleRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], mapRef.current.getZoom(), { animate: true });
    }
    circleRef.current.setRadius(radius);
  }, [lat, lng, radius]);

  return (
    <div
      ref={containerRef}
      className="w-full h-64 sm:h-72 rounded-xl overflow-hidden border border-stone-200 dark:border-stone-800 z-0"
    />
  );
};
