let map;
let markers = [];
let allStations = [];

// --- Karte initialisieren ---
function initMap(lat = 51.1657, lng = 10.4515, zoom = 6) {
  map = L.map('map').setView([lat, lng], zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap Mitwirkende'
  }).addTo(map);
}

// --- Daten laden ---
async function loadStations() {
  setStatus("Lade Tankstellendaten...");
  try {
    const res = await fetch('data/prices.json');
    const data = await res.json();
    allStations = data.stations || [];
    renderStations(allStations);
    setStatus(`${allStations.length} Tankstellen geladen.`);
  } catch (err) {
    setStatus("⚠️ Fehler beim Laden der Daten.");
    console.error(err);
  }
}

// --- Marker & Liste rendern ---
function renderStations(stations) {
  // alte Marker entfernen
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  const list = document.getElementById('stations');
  list.innerHTML = '';

  const fuelFilter = document.getElementById('fuel-filter').value;

  stations.forEach(station => {
    if (!station.lat || !station.lng) return;

    const prices = {
      e5: station.e5,
      e10: station.e10,
      diesel: station.diesel
    };

    // Marker-Popup-Inhalt
    const popupHtml = `
      <strong>${station.name}</strong><br>
      ${station.street || ''} ${station.houseNumber || ''}<br>
      ${station.postCode || ''} ${station.place || ''}<br><br>
      ${prices.e5 ? `E5: <strong>${prices.e5} €</strong><br>` : ''}
      ${prices.e10 ? `E10: <strong>${prices.e10} €</strong><br>` : ''}
      ${prices.diesel ? `Diesel: <strong>${prices.diesel} €</strong>` : ''}
    `;

    const marker = L.marker([station.lat, station.lng])
      .addTo(map)
      .bindPopup(popupHtml);
    markers.push(marker);

    // Liste
    const li = document.createElement('li');
    let priceHtml = '';
    if (fuelFilter === 'all') {
      priceHtml = `
        ${prices.e5 ? `E5: <strong>${prices.e5} €</strong> ` : ''}
        ${prices.e10 ? `E10: <strong>${prices.e10} €</strong> ` : ''}
        ${prices.diesel ? `Diesel: <strong>${prices.diesel} €</strong>` : ''}
      `;
    } else {
      const p = prices[fuelFilter];
      priceHtml = p ? `${fuelFilter.toUpperCase()}: <strong>${p} €</strong>` : 'Keine Daten';
    }

    li.innerHTML = `
      <span class="station-name">${station.name}</span>
      <span class="price">${priceHtml}</span>
    `;

    li.addEventListener('click', () => {
      map.setView([station.lat, station.lng], 15);
      marker.openPopup();
    });

    list.appendChild(li);
  });
}

// --- Standort-Suche (Geolocation) ---
function locateUser() {
  if (!navigator.geolocation) {
    setStatus("Geolocation wird von deinem Browser nicht unterstützt.");
    return;
  }

  setStatus("Suche deinen Standort...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      map.setView([latitude, longitude], 13);

      // Nutzer-Marker
      L.circleMarker([latitude, longitude], {
        radius: 8,
        color: '#e63946',
        fillColor: '#e63946',
        fillOpacity: 0.8
      }).addTo(map).bindPopup("📍 Du bist hier").openPopup();

      // Nach nächsten Tankstellen filtern (einfacher Umkreis-Filter)
      const radiusKm = parseFloat(document.getElementById('radius-input').value) || 5;
      const nearby = allStations.filter(station => {
        if (!station.lat || !station.lng) return false;
        const dist = getDistanceKm(latitude, longitude, station.lat, station.lng);
        return dist <= radiusKm;
      });

      renderStations(nearby);
      setStatus(`${nearby.length} Tankstellen im Umkreis von ${radiusKm} km gefunden.`);
    },
    (err) => {
      setStatus("⚠️ Standort konnte nicht ermittelt werden.");
      console.error(err);
    }
  );
}

// --- Haversine-Formel für Entfernung ---
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// --- Event Listener ---
document.getElementById('locate-btn').addEventListener('click', locateUser);
document.getElementById('fuel-filter').addEventListener('change', () => renderStations(allStations));

// --- Start ---
initMap();
loadStations();