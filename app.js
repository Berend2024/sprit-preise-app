/*
 * Spritpreise-Web-App
 * Erwartet Leaflet als globales window.L (z. B. über ein CDN in index.html).
 */
(function () {
  'use strict';

  var DEFAULT_LOCATION = { lat: 52.52, lng: 13.405 }; // Berlin
  var FUEL_TYPES = ['diesel', 'e5', 'e10'];
  var map;
  var markerLayer;
  var stations = [];
  var stationsLoaded = false;
  var stationsError = false;
  var currentLocation;
  var selectedFuel = 'diesel';
  var radiusKm = null;
  var config = {};

  function getConfig() {
    // config.js ist optional. Ein fehlerhaftes oder fehlendes APP_CONFIG darf
    // die Initialisierung der App nicht abbrechen.
    try {
      var candidate = window.APP_CONFIG;
      if (candidate && typeof candidate === 'object') return candidate;
      console.warn('window.APP_CONFIG nicht gefunden (config.js fehlt oder enthält einen Syntaxfehler) – verwende Fallback-Werte.');
    } catch (error) {
      console.error('Konfiguration (config.js) konnte nicht gelesen werden:', error);
    }
    return {};
  }

  function validCoordinate(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function validPrice(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  // Ungültige Datensätze werden bereits vor dem Filtern entfernt.
  function isValidStation(station) {
    if (!station || typeof station !== 'object') return false;
    if (!validCoordinate(station.lat, -90, 90) || !validCoordinate(station.lng, -180, 180)) {
      return false;
    }
    return FUEL_TYPES.some(function (fuel) {
      return validPrice(station[fuel]);
    });
  }

  function getSelectedFuel() {
    var select = document.getElementById('fuel-select');
    var value = select && select.value;
    return FUEL_TYPES.indexOf(value) !== -1 ? value : selectedFuel;
  }

  function getInitialFuel() {
    var configured = config.defaultFuel;
    var select = document.getElementById('fuel-select');
    var existing = select && select.value;
    if (FUEL_TYPES.indexOf(configured) !== -1) return configured;
    if (FUEL_TYPES.indexOf(existing) !== -1) return existing;
    return 'diesel';
  }

  function getInitialLocation() {
    if (validCoordinate(config.defaultLat, -90, 90) && validCoordinate(config.defaultLng, -180, 180)) {
      return { lat: config.defaultLat, lng: config.defaultLng };
    }
    return { lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng };
  }

  function getRadiusKm() {
    var value = Number(config.defaultRadiusKm);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function haversineDistanceKm(a, b) {
    var earthRadiusKm = 6371;
    var latDelta = (b.lat - a.lat) * Math.PI / 180;
    var lngDelta = (b.lng - a.lng) * Math.PI / 180;
    var lat1 = a.lat * Math.PI / 180;
    var lat2 = b.lat * Math.PI / 180;
    var sinLat = Math.sin(latDelta / 2);
    var sinLng = Math.sin(lngDelta / 2);
    var h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatPrice(price) {
    return Number(price).toLocaleString('de-DE', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }) + ' €';
  }

  function setStatusMessage(text) {
    var summary = document.getElementById('resultSummary');
    if (summary) summary.textContent = text;
  }

  function updateCount(count) {
    var element = document.getElementById('station-count');
    if (element) {
      element.textContent = stationsLoaded
        ? count + ' Tankstelle' + (count === 1 ? '' : 'n') + ' gefunden'
        : '—';
    }
    if (!stationsLoaded) return;
    if (stationsError) {
      setStatusMessage('Fehler beim Laden der Tankstellendaten – bitte Seite neu laden (Strg+F5).');
      return;
    }
    var radius = radiusKm !== null ? ' im Umkreis von ' + radiusKm + ' km' : '';
    setStatusMessage(count === 0
      ? 'Keine Tankstellen gefunden' + radius + '. Umkreis erhöhen oder Standort ändern.'
      : count + ' Tankstelle' + (count === 1 ? '' : 'n') + ' gefunden' + radius + '.');
  }

  function filteredStations() {
    var fuel = getSelectedFuel();
    return stations.filter(function (station) {
      if (!validPrice(station[fuel])) return false;
      if (radiusKm !== null && currentLocation &&
          haversineDistanceKm(currentLocation, station) > radiusKm) return false;
      return true;
    });
  }

  function renderStationList() {
    var listElement = document.getElementById('station-list');
    if (!listElement) return;
    if (!stationsLoaded) {
      listElement.innerHTML = '<p class="empty-state">Tankstellendaten werden geladen …</p>';
      return;
    }
    var visible = filteredStations();
    var fuel = getSelectedFuel();
    if (!visible.length) {
      listElement.innerHTML = '<p class="empty-state">Keine Tankstellen im gewählten Umkreis gefunden. '
        + '<a href="config.html">Diagnose öffnen</a></p>';
      return;
    }
    listElement.innerHTML = '<ul id="stations">' + visible.map(function (station) {
      var address = [station.street, station.houseNumber, station.postCode, station.place]
        .filter(function (part) { return part; })
        .join(', ');
      return '<li>' +
        '<span class="station-name">' + escapeHtml(station.name || 'Tankstelle') + '</span>' +
        '<span class="price"><strong>' + formatPrice(station[fuel]) + '</strong>' +
        (address ? ' – ' + escapeHtml(address) : '') + '</span>' +
        '</li>';
    }).join('') + '</ul>';
  }

  function renderMarkers() {
    var visible = filteredStations();
    updateCount(visible.length);
    renderStationList();
    if (!markerLayer) return;

    markerLayer.clearLayers();
    visible.forEach(function (station) {
      try {
        var marker = window.L.marker([station.lat, station.lng]);
        marker.bindPopup(
          '<strong>' + escapeHtml(station.name || 'Tankstelle') + '</strong><br>' +
          escapeHtml(getSelectedFuel().toUpperCase()) + ': ' + formatPrice(station[getSelectedFuel()])
        );
        marker.addTo(markerLayer);
      } catch (error) {
        console.error('Marker konnte nicht erstellt werden:', error, station);
      }
    });
  }

  function initMap() {
    if (map) return true; // Karte nicht mehrfach initialisieren (z. B. bei erneutem Standort-Update)
    if (!window.L || typeof window.L.map !== 'function') {
      console.error('Leaflet (window.L) ist nicht verfügbar. Karte kann nicht initialisiert werden.');
      updateCount(0);
      return false;
    }
    var mapElement = document.getElementById('map');
    if (!mapElement) {
      console.error('Kein Element mit id="map" gefunden.');
      updateCount(0);
      return false;
    }
    try {
      currentLocation = getInitialLocation();
      map = window.L.map(mapElement).setView([currentLocation.lat, currentLocation.lng], 12);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      markerLayer = window.L.layerGroup().addTo(map);
      // Rendering-Probleme bei verzögertem/dynamischem Layout ausgleichen:
      map.invalidateSize();
      setTimeout(function () {
        if (map) map.invalidateSize();
      }, 200);
      return true;
    } catch (error) {
      console.error('Karte konnte nicht initialisiert werden:', error);
      return false;
    }
  }

  function useLocation(position) {
    var coords = position && position.coords;
    if (!coords || !validCoordinate(coords.latitude, -90, 90) || !validCoordinate(coords.longitude, -180, 180)) {
      console.warn('Geolocation lieferte ungültige Koordinaten; verwende Fallback.');
      return false;
    }
    currentLocation = { lat: coords.latitude, lng: coords.longitude };
    if (map) map.setView([currentLocation.lat, currentLocation.lng], 13);
    renderMarkers();
    console.log('Standort verwendet:', currentLocation);
    return true;
  }

  function locateUser() {
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
      console.warn('Geolocation API nicht verfügbar; Fallback wird verwendet.');
      currentLocation = getInitialLocation();
      if (map) map.setView([currentLocation.lat, currentLocation.lng], 12);
      renderMarkers();
      return;
    }
    navigator.geolocation.getCurrentPosition(useLocation, function (error) {
      console.warn('Geolocation fehlgeschlagen (Fallback wird verwendet):', error && error.message);
      currentLocation = getInitialLocation();
      if (map) map.setView([currentLocation.lat, currentLocation.lng], 12);
      renderMarkers();
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function bindControls() {
    var fuelSelect = document.getElementById('fuel-select');
    if (fuelSelect) {
      fuelSelect.value = selectedFuel;
      fuelSelect.addEventListener('change', function () {
        selectedFuel = getSelectedFuel();
        renderMarkers();
      });
    }
    var radiusInput = document.getElementById('radiusInput');
    if (radiusInput) {
      radiusInput.value = radiusKm !== null ? radiusKm : '';
      radiusInput.addEventListener('input', function () {
        var value = Number(radiusInput.value);
        radiusKm = Number.isFinite(value) && value > 0 ? value : null;
        renderMarkers();
      });
    }
    var locateButton = document.getElementById('locate-btn');
    if (locateButton) locateButton.addEventListener('click', locateUser);
  }

  function loadStations() {
    return fetch('data/prices.json', { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status + ' beim Laden von data/prices.json');
        return response.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.stations)) throw new Error('Ungültiges JSON-Format: stations fehlt.');
        stations = data.stations.filter(isValidStation);
        stationsLoaded = true;
        console.log('Tankstellendaten geladen:', data.stations.length, 'gesamt,', stations.length, 'gültig.');
      })
      .catch(function (error) {
        stations = [];
        stationsLoaded = true;
        stationsError = true;
        console.error('Tankstellendaten konnten nicht geladen werden:', error);
        setStatusMessage('Fehler beim Laden der Tankstellendaten – bitte Seite neu laden (Strg+F5).');
      });
  }

  function init() {
    try {
      config = getConfig();
      selectedFuel = getInitialFuel();
      radiusKm = getRadiusKm();
      bindControls();
      initMap();
      // Standort zuerst versuchen; bei Fehler setzt locateUser den Fallback.
      locateUser();
      loadStations().then(renderMarkers).catch(function (error) {
        console.error('Unerwarteter Fehler beim Laden der Tankstellen:', error);
        renderMarkers();
      });
    } catch (error) {
      console.error('Unerwarteter Initialisierungsfehler:', error);
      updateCount(0);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
