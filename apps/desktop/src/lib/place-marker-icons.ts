import alarm from '../assets/markers/alarm.png';
import home from '../assets/markers/home.png';
import hospital from '../assets/markers/hospital.png';
import market from '../assets/markers/market.png';
import office from '../assets/markers/office.png';
import parking from '../assets/markers/parking.png';
import police from '../assets/markers/police.png';
import { DEFAULT_PLACE_MARKER_ICON_ID, type PlaceMarkerIconId } from '../../shared/place-markers';

export type PlaceMarkerIconDefinition = {
  id: PlaceMarkerIconId;
  label: string;
  src: string;
};

export const PLACE_MARKER_ICONS: PlaceMarkerIconDefinition[] = [
  { id: 'red-pin', label: '赤ピン', src: alarm },
  { id: 'blue-pin', label: '青ピン', src: police },
  { id: 'green-pin', label: '緑ピン', src: market },
  { id: 'yellow-pin', label: '黄ピン', src: home },
  { id: 'warning', label: '注意', src: alarm },
  { id: 'camera', label: 'カメラ', src: police },
  { id: 'facility', label: '施設', src: hospital },
  { id: 'parking', label: '駐車場', src: parking },
  { id: 'office', label: '事務所', src: office },
  { id: 'work-area', label: '作業場', src: market },
];

export function getPlaceMarkerIcon(id: string): PlaceMarkerIconDefinition {
  return (
    PLACE_MARKER_ICONS.find((icon) => icon.id === id) ??
    PLACE_MARKER_ICONS.find((icon) => icon.id === DEFAULT_PLACE_MARKER_ICON_ID) ??
    PLACE_MARKER_ICONS[0]!
  );
}
