/* global L, APP_CONFIG */

'use strict';

/*
 * Erwartetes Format von data/prices.json:
 * [
 *   {
 *     "name": "Tankstelle Musterstadt",
 *     "brand": "Beispiel",
 *     "lat": 52.5205,
 *     "lng": 13.4060,
 *     "diesel": 1.659,
 *     "e5": 1.799,
 *     "e10": 1.739,
 *     "address": "Musterstraße 1, 10115 Berlin"
 *   }
 * ]
 *
 * Preise sind Euro pro Liter. "address" ist optional; alle anderen Felder
 * sollten für eine gültige Tankstelle vorhanden sein.
 */

const config = window.APP_CONFIG || {};
const DEFAULT_LAT = Number.isFinite(Number(config.defaultLat)) ? Number(config.defaultLat) : 52.5200;
const DEFAULT_LNG = Number.isFinite(Number(config.defaultLng)) ? Number(config.defaultLng) : 13.4050;
const DEFAULT_RADIUS = clamp(Number(config.defaultRadiusKm) || 25, 1, 200);
const VALID_FUELS = new Set(['diesel', 'e5', 'e10']);

let currentLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
let stations = [];
let map;
let markerLayer;
let userMarker;

const fuelLabels = {
  diesel: 'Diesel',
  e5: 'Super E5',
  e10: 'Super E10'
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  elements.map = document.getElementById('map');
  elements.stationList = document.getElementById('stationList');
  elements.stationCount = document.getElementById('stationCount');
  elements.resultSummary = document.getElementById('resultSummary');
  elements.statusMessage = document.getElementById('statusMessage');
  elements.fuelSelect = document.getElementById('fuelSelect');
  elements.radiusInput = document.getElementById('radiusInput');
  elements.locateButton = document.getElementById('locateButton');

  const configuredFuel = VALID_FUELS.has(config.defaultFuel) ? config.defaultFuel : 'diesel';
  elements.fuelSelect.value = configuredFuel;
  elements.radiusInput.value = DEFAULT_RADIUS;

  map = L.map(elements.map, { zoomControl: true }).setView(
    [currentLocation.lat, currentLocation.lng],
    zoomForRadius(DEFAULT_RADIUS)
  );
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  setUserMarker();

  elements.fuelSelect.addEventListener('change', renderResults);
  elements.radiusInput.addEventListener('input', renderResults);
  elements.locateButton.addEventListener('click', useCurrentLocation);

  try {
    const response = await fetch('data/prices.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Die JSON-Datei enthält kein Array.');
    stations = data.filter(isValidStation);
    renderResults();
  } catch (error) {
    console.error('Tankstellendaten konnten nicht geladen werden:', error);
    showStatus('Die Tankstellendaten konnten nicht geladen werden. Bitte später erneut versuchen.', true);
    elements.stationList.innerHTML = '<p class="empty-state">Keine Tankstellendaten verfügbar.</p>';
    elements.resultSummary.textContent = 'Keine Tankstellen gefunden';
    elements.stationCount.textContent = '0';
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    showStatus('Dein Browser unterstützt keine Standortbestimmung.', true);
    return;
  }

  elements.locateButton.disabled = true;
  elements.locateButton.setAttribute('aria-busy', 'true');
  showStatus('Standort wird ermittelt …');

  try {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        map.setView([currentLocation.lat, currentLocation.lng], zoomForRadius(getRadius()));
        setUserMarker();
        renderResults();
        showStatus('Standort aktualisiert.');
        resetLocationButton();
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Standortzugriff wurde abgelehnt. Bitte erlaube ihn im Browser oder nutze die Standardposition.'
          : 'Standort konnte nicht ermittelt werden. Bitte versuche es erneut.';
        showStatus(message, true);
        resetLocationButton();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  } catch (error) {
    console.error('Fehler bei der Standortbestimmung:', error);
    showStatus('Bei der Standortbestimmung ist ein Fehler aufgetreten.', true);
    resetLocationButton();
  }
}

function renderResults() {
  const fuel = VALID_FUELS.has(elements.fuelSelect.value) ? elements.fuelSelect.value : 'diesel';
  const radius = getRadius();
  elements.radiusInput.value = radius;
  map.setView([currentLocation.lat, currentLocation.lng], zoomForRadius(radius), { animate: false });

  const nearby = stations
    .map((station) => ({ ...station, distance: haversineDistance(currentLocation, station) }))
    .filter((station) => station.distance <= radius && Number.isFinite(Number(station[fuel])))
    .sort((a, b) => Number(a[fuel]) - Number(b[fuel]) || a.distance - b.distance);

  markerLayer.clearLayers();
  nearby.forEach((station) => addStationMarker(station, fuel));
  renderStationList(nearby, fuel);
  elements.resultSummary.textContent = `${nearby.length} Tankstellen im Umkreis von ${formatNumber(radius)} km gefunden`;
  elements.stationCount.textContent = String(nearby.length);
}

function addStationMarker(station, fuel) {
  const marker = L.marker([station.lat, station.lng]).addTo(markerLayer);
  marker.bindPopup(`<strong>${escapeHtml(station.name)}</strong><br>${fuelLabels[fuel]}: ${formatPrice(station[fuel])}<br>${formatDistance(station.distance)}`);
}

function renderStationList(nearby, fuel) {
  elements.stationList.replaceChildren();
  if (!nearby.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'In diesem Umkreis wurden keine passenden Tankstellen gefunden.';
    elements.stationList.appendChild(empty);
    return;
  }

  nearby.forEach((station, index) => {
    const article = document.createElement('article');
    article.className = 'station-card';
    article.innerHTML = `
      <div class="station-rank">${index + 1}</div>
      <div class="station-details">
        <h3>${escapeHtml(station.name)}</h3>
        <p class="station-meta">${escapeHtml(station.brand || 'Tankstelle')} · ${formatDistance(station.distance)}</p>
        ${station.address ? `<p class="station-address">${escapeHtml(station.address)}</p>` : ''}
      </div>
      <strong class="station-price">${formatPrice(station[fuel])}</strong>`;
    article.addEventListener('click', () => {
      map.setView([station.lat, station.lng], 15);
      markerLayer.eachLayer((marker) => {
        if (marker.getLatLng().lat === station.lat && marker.getLatLng().lng === station.lng) marker.openPopup();
      });
    });
    elements.stationList.appendChild(article);
  });
}

function setUserMarker() {
  if (userMarker) userMarker.remove();
  userMarker = L.circleMarker([currentLocation.lat, currentLocation.lng], {
    radius: 8, color: '#ffffff', weight: 3, fillColor: '#ef6c3b', fillOpacity: 1
  }).bindTooltip('Dein Standort').addTo(map);
}

function isValidStation(station) {
  return station && typeof station.name === 'string' &&
    Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lng));
}

function haversineDistance(from, to) {
  const earthRadiusKm = 6371;
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(Number(to.lat));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(to.lng) - from.lng);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getRadius() {
  const value = Number(elements.radiusInput.value);
  return clamp(Number.isFinite(value) ? value : DEFAULT_RADIUS, 1, 200);
}
function zoomForRadius(radius) { return radius <= 5 ? 14 : radius <= 15 ? 12 : radius <= 40 ? 11 : 9; }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
function toRadians(value) { return value * Math.PI / 180; }
function formatNumber(value) { return Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 }); }
function formatDistance(value) { return `${formatNumber(value)} km entfernt`; }
function formatPrice(value) { return `${Number(value).toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`; }
function showStatus(message, isError = false) { elements.statusMessage.textContent = message; elements.statusMessage.classList.toggle('is-error', isError); }
function resetLocationButton() { elements.locateButton.disabled = false; elements.locateButton.removeAttribute('aria-busy'); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
