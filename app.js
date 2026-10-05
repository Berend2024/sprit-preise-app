/*
 * Spritpreise-Web-App
 * Erwartet Leaflet als globales window.L (z. B. über ein CDN in index.html).
 */
(function () {
  'use strict';

  var DEFAULT_LOCATION = { lat: 52.52, lng: 13.405 }; // Berlin
  var FUEL_TYPES = ['diesel', 'e5', 'e10', 'superplus'];
  var map;
  var markerLayer;
  var stations = [];
  var stationsLoaded = false;
  var stationsError = false;
  var currentLocation;
  var selectedFuel = 'diesel';
  var radiusKm = null;
  var config = {};
  var selectedStationId = null;
  var markersById = {};
  // Smart-Tanken: Verbrauch, Tankmenge und Kostenmodell
  var TRIP_CORRECTION_FACTOR = 1.3; // Strassenweg statt Luftlinie: ca. 30 % zusaetzlich
  var ROUND_TRIPS = 2;              // Hin- und Rueckfahrt
  var CONSUMPTION_LIMITS = { min: 1, max: 30 };   // L/100km
  var TANK_LIMITS = { min: 5, max: 150 };         // Liter
  var consumptionLPer100 = null;
  var tankLiters = null;

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

  // Eindeutiger Schluessel zur Zuordnung von Listeneintrag und Marker.
  function stationKey(station) {
    if (station && station.id != null) return String(station.id);
    var index = stations.indexOf(station);
    return index !== -1 ? 'index-' + index : '';
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

  // Haversine-Formel: Luftlinien-Entfernung zwischen zwei Koordinaten (km).
  function haversine(lat1, lng1, lat2, lng2) {
    var earthRadiusKm = 6371;
    var latDelta = (lat2 - lat1) * Math.PI / 180;
    var lngDelta = (lng2 - lng1) * Math.PI / 180;
    var lat1Rad = lat1 * Math.PI / 180;
    var lat2Rad = lat2 * Math.PI / 180;
    var sinLat = Math.sin(latDelta / 2);
    var sinLng = Math.sin(lngDelta / 2);
    var h = sinLat * sinLat + Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinLng * sinLng;
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

  function formatCost(value) {
    return Number(value).toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' €';
  }

  function formatDistance(km) {
    return Number(km).toLocaleString('de-DE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }) + ' km';
  }

  // Adresse einer Tankstelle als einzeilige Zeichenkette.
  function stationAddress(station) {
    return [station.street, station.houseNumber, station.postCode, station.place]
      .filter(function (part) { return part; })
      .join(', ');
  }

  // Google-Maps-Route-Link: mit Startpunkt, wenn ein Standort bekannt ist,
  // sonst reine Zielsuche. Reine Weiterleitung, keine API-Anfrage.
  function googleMapsUrl(station) {
    var destination = station.lat + ',' + station.lng;
    if (currentLocation && validCoordinate(currentLocation.lat, -90, 90) && validCoordinate(currentLocation.lng, -180, 180)) {
      return 'https://www.google.com/maps/dir/?api=1&origin=' + currentLocation.lat + ',' + currentLocation.lng +
        '&destination=' + destination + '&travelmode=driving';
    }
    return 'https://www.google.com/maps/search/?api=1&query=' + destination;
  }

  // Adresszeile plus Aktionszeile: Route-Link und Koordinaten-Kopierbutton.
  function mapsLinkHtml(station) {
    var address = stationAddress(station);
    var coords = station.lat + ', ' + station.lng;
    var copyText = 'Lat,Lng: ' + coords + (address ? ' – ' + address : '');
    return '<span class="station-address">📍 ' + (address ? escapeHtml(address) : escapeHtml(coords)) + '</span>' +
      '<span class="station-actions">' +
      '<a class="maps-link" href="' + escapeHtml(googleMapsUrl(station)) + '" target="_blank" rel="noopener noreferrer">🗺️ Route</a>' +
      '<button type="button" class="copy-coords-btn" title="Koordinaten kopieren" data-copy="' + escapeHtml(copyText) + '">📋' +
      '<span class="copy-tooltip" aria-live="polite">Kopiert!</span>' +
      '</button>' +
      '</span>';
  }

  // ----- Smart-Tanken: Eingaben, Speicherung und Kostenmodell -----

  // Deutsche Eingabe mit Komma (z. B. "7,5") wird akzeptiert.
  function parseNumberInput(raw) {
    if (raw == null) return NaN;
    return Number(String(raw).trim().replace(',', '.'));
  }

  function validWithinLimits(value, limits) {
    return Number.isFinite(value) && value >= limits.min && value <= limits.max;
  }

  function hasCostInputs() {
    return consumptionLPer100 !== null && tankLiters !== null;
  }

  // Gesamtkosten: Anfahrt (Hin + Rueck, Korrekturfaktor fuer echte Strasse)
  // plus Tankfuellung zum Preis vor Ort.
  function totalCostEur(distanceKm, pricePerLiter) {
    var tripLiters = distanceKm * TRIP_CORRECTION_FACTOR * ROUND_TRIPS * consumptionLPer100 / 100;
    return (tripLiters + tankLiters) * pricePerLiter;
  }

  function loadStoredNumber(key, limits) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      var value = parseNumberInput(raw);
      return validWithinLimits(value, limits) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function storeNumber(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(value));
    } catch (error) {
      // localStorage kann z. B. im privaten Modus blockiert sein – nicht kritisch.
    }
  }

  function loadCostSettings() {
    consumptionLPer100 = loadStoredNumber('fuelConsumption', CONSUMPTION_LIMITS);
    tankLiters = loadStoredNumber('tankAmount', TANK_LIMITS);
  }

  function readCostInputs() {
    var consumptionInput = document.getElementById('fuel-consumption');
    var tankInput = document.getElementById('tank-amount');
    var consumption = consumptionInput ? parseNumberInput(consumptionInput.value) : NaN;
    var tank = tankInput ? parseNumberInput(tankInput.value) : NaN;
    consumptionLPer100 = validWithinLimits(consumption, CONSUMPTION_LIMITS) ? consumption : null;
    tankLiters = validWithinLimits(tank, TANK_LIMITS) ? tank : null;
    storeNumber('fuelConsumption', consumptionLPer100);
    storeNumber('tankAmount', tankLiters);
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

  // Umkreis-Praedikat, gemeinsam fuer Tankstellen und Ladesaeulen:
  // ohne Standort oder ohne gesetzten Umkreis ist alles sichtbar.
  function withinRadius(lat, lng) {
    return radiusKm === null || !currentLocation ||
      haversine(currentLocation.lat, currentLocation.lng, lat, lng) <= radiusKm;
  }

  function filteredStations() {
    var fuel = getSelectedFuel();
    return stations.filter(function (station) {
      if (!validPrice(station[fuel])) return false;
      return withinRadius(station.lat, station.lng);
    });
  }

  // Smart-Tanken: pro sichtbarer Tankstelle Entfernung und (moegliche)
  // Gesamtkosten berechnen und danach sortieren.
  function computeDecoratedStations() {
    var fuel = getSelectedFuel();
    var costsAvailable = hasCostInputs();
    return filteredStations().map(function (station) {
      var distanceKm = currentLocation
        ? haversine(currentLocation.lat, currentLocation.lng, station.lat, station.lng)
        : null;
      var totalCost = (costsAvailable && distanceKm !== null)
        ? totalCostEur(distanceKm, station[fuel])
        : null;
      return { station: station, distanceKm: distanceKm, totalCost: totalCost };
    }).sort(function (a, b) {
      // Primaer nach Gesamtkosten, sekundaer nach Preis pro Liter.
      if (a.totalCost !== null && b.totalCost !== null && a.totalCost !== b.totalCost) {
        return a.totalCost - b.totalCost;
      }
      return a.station[fuel] - b.station[fuel];
    });
  }

  function updateSortHint() {
    var header = document.getElementById('station-list-header');
    if (!header) return;
    header.textContent = hasCostInputs()
      ? 'Sortiert nach: Gesamtkosten (inkl. Anfahrt)'
      : 'Verbrauch & Tankmenge eingeben für Gesamtkosten – günstigster Preis pro Liter ist markiert';
  }

  // ----- Koordinaten in die Zwischenablage kopieren -----

  function handleCopyCoords(button) {
    var text = button.getAttribute('data-copy');
    if (!text) return;
    copyToClipboard(text, function () {
      var tooltip = button.querySelector('.copy-tooltip');
      if (!tooltip) return;
      tooltip.classList.add('show');
      setTimeout(function () {
        tooltip.classList.remove('show');
      }, 1500);
    });
  }

  function copyToClipboard(text, onSuccess) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(onSuccess, function () {
        copyViaTextarea(text, onSuccess);
      });
      return;
    }
    copyViaTextarea(text, onSuccess);
  }

  // Fallback fuer aeltere Browser bzw. unsichere Kontexte (z. B. file://).
  function copyViaTextarea(text, onSuccess) {
    try {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      onSuccess();
    } catch (error) {
      console.warn('Koordinaten konnten nicht kopiert werden:', error);
    }
  }

  function renderStationList(decorated) {
    var listElement = document.getElementById('station-list');
    if (!listElement) return;
    if (!stationsLoaded) {
      listElement.innerHTML = '<p class="empty-state">Tankstellendaten werden geladen …</p>';
      return;
    }
    updateSortHint();
    if (!decorated.length) {
      listElement.innerHTML = '<p class="empty-state">Keine Tankstellen im gewählten Umkreis gefunden. '
        + '<a href="config.html">Diagnose öffnen</a></p>';
      return;
    }
    var fuel = getSelectedFuel();
    listElement.innerHTML = '<ul id="stations">' + decorated.map(function (entry, index) {
      var station = entry.station;
      var key = stationKey(station);
      // Index 0 ist nach Sortierung guenstigst: bei gesetzten Eingaben nach
      // Gesamtkosten, sonst (Fallback) nach Preis pro Liter.
      var isBestDeal = index === 0;
      var classes = 'station-item'
        + (key && key === selectedStationId ? ' active' : '')
        + (isBestDeal ? ' best-deal' : '');
      return '<li class="' + classes + '" data-station-id="' + escapeHtml(key) + '">' +
        (isBestDeal ? '<span class="best-deal-badge">🏆 Günstigste Wahl</span>' : '') +
        '<span class="station-name">' + escapeHtml(station.name || 'Tankstelle') + '</span>' +
        '<span class="price' + (entry.totalCost !== null ? '' : ' station-price-only') + '"><strong>' +
        formatPrice(station[fuel]) + '</strong></span>' +
        mapsLinkHtml(station) +
        (entry.distanceKm !== null
          ? '<span class="station-distance">' + formatDistance(entry.distanceKm) + ' Luftlinie</span>'
          : '') +
        (entry.totalCost !== null
          ? '<span class="station-total-cost">Gesamtkosten: ' + formatCost(entry.totalCost) + ' (inkl. Anfahrt)</span>'
          : '') +
        '</li>';
    }).join('') + '</ul>';
    // Bestes Angebot in den sichtbaren Bereich der Liste scrollen.
    var bestItem = listElement.querySelector('li.best-deal');
    if (bestItem && typeof bestItem.scrollIntoView === 'function') {
      bestItem.scrollIntoView({ block: 'nearest' });
    }
  }

  function createBestDealIcon() {
    return window.L.divIcon({
      className: 'best-deal-marker',
      html: '<div class="best-deal-pin" title="Günstigste Wahl"></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -18]
    });
  }

  function renderMarkers() {
    var decorated = computeDecoratedStations();
    updateCount(decorated.length);
    renderStationList(decorated);
    renderMapMarkers(decorated);
  }

  function renderMapMarkers(decorated) {
    if (!markerLayer) return;
    var fuel = getSelectedFuel();

    markerLayer.clearLayers();
    markersById = {};
    decorated.forEach(function (entry, index) {
      var station = entry.station;
      try {
        var isBestDeal = index === 0;
        var marker = window.L.marker([station.lat, station.lng],
          isBestDeal ? { icon: createBestDealIcon() } : undefined);
        var details = '';
        if (entry.distanceKm !== null) {
          details += '<br>Luftlinie: ' + formatDistance(entry.distanceKm);
        }
        if (entry.totalCost !== null) {
          details += '<br><strong>Gesamt: ' + formatCost(entry.totalCost) + ' (inkl. Anfahrt)</strong>';
        }
        marker.bindPopup(
          '<strong>' + escapeHtml(station.name || 'Tankstelle') + '</strong><br>' +
          escapeHtml(fuel.toUpperCase()) + ': ' + formatPrice(station[fuel]) +
          details +
          '<br>' + mapsLinkHtml(station)
        );
        marker.addTo(markerLayer);
        markersById[stationKey(station)] = marker;
      } catch (error) {
        console.error('Marker konnte nicht erstellt werden:', error, station);
      }
    });
  }

  function updateListSelection(key) {
    var listElement = document.getElementById('station-list');
    if (!listElement) return;
    var items = listElement.querySelectorAll('li[data-station-id]');
    Array.prototype.forEach.call(items, function (item) {
      item.classList.toggle('active', item.getAttribute('data-station-id') === key);
    });
  }

  function focusStation(key) {
    var station = stations.filter(function (candidate) {
      return stationKey(candidate) === key;
    })[0];
    selectedStationId = key;
    updateListSelection(key);
    if (!station) return;
    var marker = markersById[key];
    if (marker && typeof marker.openPopup === 'function') marker.openPopup();
    if (map) {
      // Nicht herauszoomen, wenn bereits naeher an die Karte herangezoomt wurde.
      var targetZoom = Math.max(map.getZoom(), 16);
      map.flyTo([station.lat, station.lng], targetZoom, { duration: 0.8 });
    }
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
    renderChargingMarkers();
    console.log('Standort verwendet:', currentLocation);
    return true;
  }

  function locateUser() {
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
      console.warn('Geolocation API nicht verfügbar; Fallback wird verwendet.');
      currentLocation = getInitialLocation();
      if (map) map.setView([currentLocation.lat, currentLocation.lng], 12);
      renderMarkers();
      renderChargingMarkers();
      return;
    }
    navigator.geolocation.getCurrentPosition(useLocation, function (error) {
      console.warn('Geolocation fehlgeschlagen (Fallback wird verwendet):', error && error.message);
      currentLocation = getInitialLocation();
      if (map) map.setView([currentLocation.lat, currentLocation.lng], 12);
      renderMarkers();
      renderChargingMarkers();
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
        renderChargingMarkers();
      });
    }
    var locateButton = document.getElementById('locate-btn');
    if (locateButton) locateButton.addEventListener('click', locateUser);

    // Smart-Tanken: Verbrauch & Tankmenge – live berechnen und speichern.
    var consumptionInput = document.getElementById('fuel-consumption');
    if (consumptionInput) {
      if (consumptionLPer100 !== null) consumptionInput.value = String(consumptionLPer100);
      consumptionInput.addEventListener('input', function () {
        readCostInputs();
        renderMarkers();
      });
    }
    var tankInput = document.getElementById('tank-amount');
    if (tankInput) {
      if (tankLiters !== null) tankInput.value = String(tankLiters);
      tankInput.addEventListener('input', function () {
        readCostInputs();
        renderMarkers();
      });
    }
    var calculateButton = document.getElementById('calculate-costs-btn');
    if (calculateButton) {
      calculateButton.addEventListener('click', function () {
        readCostInputs();
        renderMarkers();
      });
    }
    // Event-Delegation: ueberlebt das regelmaessige Neu-Rendern der Liste.
    var stationList = document.getElementById('station-list');
    if (stationList) {
      stationList.addEventListener('click', function (event) {
        // Route-Link und Kopierbutton loesen keinen Zoom auf die Karte aus.
        if (event.target.closest('.copy-coords-btn')) return;
        if (event.target.closest('a.maps-link')) return;
        var item = event.target.closest('li[data-station-id]');
        if (item) focusStation(item.getAttribute('data-station-id'));
      });
    }
    // Kopieren global abfangen, damit es auch im Karten-Popup funktioniert.
    document.addEventListener('click', function (event) {
      var copyButton = event.target.closest('.copy-coords-btn');
      if (copyButton) handleCopyCoords(copyButton);
    });
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

  // ===================================================================
  // Tankstellen-Ebene: Marker-Layer (markerLayer ist bereits eine
  // LayerGroup) ueber die Checkbox ein-/ausschalten. Die Berechnungs-
  // logik (renderMarkers) bleibt unangetastet - nur die Sichtbarkeit
  // der Kartenmarker und der Ergebnisliste rechts wird gekoppelt.
  // Beim Wieder-Aktivieren erscheinen die bereits geladenen Marker
  // ohne neuen Datenabruf wieder.
  // ===================================================================

  function initFuelControls() {
    var checkbox = document.getElementById('toggle-stations');
    var listPanel = document.getElementById('station-panel');
    var summary = document.getElementById('resultSummary');
    if (!checkbox) return;
    checkbox.addEventListener('change', function () {
      var hide = !checkbox.checked;
      // Ergebnisliste rechts UND Statuszeile ("X Tankstellen gefunden")
      // ein-/ausblenden (gleiche hidden-Klasse wie Panels).
      if (listPanel) listPanel.classList.toggle('hidden', hide);
      if (summary) summary.classList.toggle('hidden', hide);
      if (!map || !markerLayer) return;
      if (checkbox.checked) map.addLayer(markerLayer);
      else map.removeLayer(markerLayer);
    });
  }

  // ===================================================================
  // E-Ladesaeulen: eigene Marker-Kategorie, unabhaengig von der
  // Tankstellen-Logik. Laedt data/charging_stations.json einmalig in
  // den Speicher; Marker werden nur bei aktivierter Checkbox angezeigt
  // und analog zu den Tankstellen auf den gewaehlten Umkreis gefiltert.
  // ===================================================================

  var chargingLayer = null;
  var chargingStations = []; // einmalig geladen, Marker folgen erst beim Rendern
  var chargingLoaded = false;

  function ensureChargingLayer() {
    if (!chargingLayer && map && window.L && typeof window.L.layerGroup === 'function') {
      // Clustering, wenn das Plugin geladen ist; sonst einfacher
      // Fallback-Layer, damit die App ohne CDN nicht bricht.
      if (typeof window.L.markerClusterGroup === 'function') {
        chargingLayer = window.L.markerClusterGroup({
          chunkedLoading: true,
          maxClusterRadius: 50,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          disableClusteringAtZoom: 16
        });
      } else {
        chargingLayer = window.L.layerGroup();
      }
    }
    return chargingLayer;
  }

  function createChargingIcon() {
    return window.L.divIcon({
      className: 'charging-marker',
      html: '<div class="charging-pin" title="E-Ladesäule">⚡</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14]
    });
  }

  function filteredChargingStations() {
    return chargingStations.filter(function (station) {
      return withinRadius(station.lat, station.lon);
    });
  }

  // Popup-Aufbau: Name, Adresse, Leistung/Steckertyp, Ladepunkt-Anzahl,
  // Betreiber, Route-Link. Fehlende Felder werden uebersprungen.
  function chargingPopupHtml(station) {
    var lines = [];
    if (station.power_kw != null) lines.push('Leistung: ' + escapeHtml(station.power_kw) + ' kW');
    if (station.connector_type) lines.push('Steckertyp: ' + escapeHtml(station.connector_type));
    if (station.points === 1) lines.push('1 Ladepunkt');
    else if (station.points != null) lines.push(escapeHtml(station.points) + ' Ladepunkte');
    if (station.operator) lines.push('Betreiber: ' + escapeHtml(station.operator));
    var html = '<strong>' + escapeHtml(station.name || 'Ladesäule') + '</strong>';
    if (station.address) html += '<br>' + escapeHtml(station.address);
    if (lines.length) html += '<br>' + lines.join('<br>');
    var routeUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + station.lat + ',' + station.lon;
    html += '<br><a class="maps-link" href="' + escapeHtml(routeUrl) +
      '" target="_blank" rel="noopener noreferrer">Route planen</a>';
    return html;
  }

  function renderChargingMarkers() {
    var layer = ensureChargingLayer();
    if (!layer || !chargingLoaded) return;
    layer.clearLayers();
    filteredChargingStations().forEach(function (station) {
      window.L.marker([station.lat, station.lon], { icon: createChargingIcon() })
        .bindPopup(chargingPopupHtml(station))
        .addTo(layer);
    });
  }

  function loadChargingStations() {
    fetch('data/charging_stations.json', { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status + ' beim Laden von data/charging_stations.json');
        return response.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.stations)) throw new Error('Ungültiges JSON-Format: stations fehlt.');
        chargingStations = data.stations.filter(function (station) {
          return validCoordinate(station.lat, -90, 90) && validCoordinate(station.lon, -180, 180);
        });
        chargingLoaded = true;
        console.log('Ladesäulen geladen:', data.stations.length, 'gesamt,', chargingStations.length, 'gültig.');
        renderChargingMarkers();
      })
      .catch(function (error) {
        console.warn('Ladesäulen konnten nicht geladen werden:', error);
      });
  }

  function initChargingControls() {
    var checkbox = document.getElementById('toggle-charging');
    if (!checkbox) return;
    checkbox.addEventListener('change', function () {
      var layer = ensureChargingLayer();
      if (!layer || !map) return;
      if (checkbox.checked) {
        // Marker anhand des aktuellen Standorts/Umkreises aufbauen, dann einblenden.
        renderChargingMarkers();
        map.addLayer(layer);
      } else {
        map.removeLayer(layer);
      }
    });
  }

  function init() {
    try {
      config = getConfig();
      selectedFuel = getInitialFuel();
      radiusKm = getRadiusKm();
      loadCostSettings();
      bindControls();
      initMap();
      // E-Ladesaeulen: Checkbox verdrahten und Daten einmalig laden;
      // sichtbar wird die Ebene erst bei aktivierter Checkbox.
      initFuelControls();
      initChargingControls();
      loadChargingStations();
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
