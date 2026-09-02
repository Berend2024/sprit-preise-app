/*
 * Konfigurations- und Diagnoseseite
 * Prueft config.js, prices.json, Standort-Abdeckung, den GitHub-Workflow und
 * den Tankerkoenig-API-Key und hebt ungueltige Parameter farblich hervor.
 */
(function () {
  'use strict';

  var FUEL_TYPES = ['diesel', 'e5', 'e10'];
  var WORKFLOW_FILE = 'update-prices.yml';
  var DEFAULT_LOCATION = { lat: 52.52, lng: 13.405 }; // Berlin (Fallback)
  var API_BASE = 'https://creativecommons.tankerkoenig.de/json/list.php';

  var checksTotal = 0;
  var checksFailed = 0;
  var checksWarned = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function validCoordinate(value, min, max) {
    return isFiniteNumber(value) && value >= min && value <= max;
  }

  function validPrice(value) {
    return isFiniteNumber(value) && value > 0;
  }

  function isValidStation(station) {
    if (!station || typeof station !== 'object') return false;
    if (!validCoordinate(station.lat, -90, 90) || !validCoordinate(station.lng, -180, 180)) return false;
    return FUEL_TYPES.some(function (fuel) { return validPrice(station[fuel]); });
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

  function parseDate(value) {
    if (!value) return null;
    var time = Date.parse(value);
    return isNaN(time) ? null : new Date(time);
  }

  function formatDateTime(date) {
    return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatAge(hours) {
    if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' Min.';
    if (hours < 24) {
      var h = Math.round(hours);
      return h + (h === 1 ? ' Std.' : ' Std.');
    }
    var days = Math.round(hours / 24);
    return days + (days === 1 ? ' Tag' : ' Tagen');
  }

  function getRepoSlug() {
    // Auf GitHub Pages (user.github.io/repo) laesst sich owner/repo ableiten,
    // lokal wird ein Fallback verwendet.
    var host = window.location.hostname;
    var parts = window.location.pathname.split('/').filter(function (part) { return part; });
    if (host.indexOf('.github.io') !== -1 && parts.length > 0) {
      return host.split('.')[0] + '/' + parts[0];
    }
    return 'Berend2024/sprit-preise-app';
  }

  function addRow(containerId, name, value, level, hint) {
    var container = $(containerId);
    if (!container) return;
    checksTotal += 1;
    if (level === 'fail') checksFailed += 1;
    if (level === 'warn') checksWarned += 1;
    var labels = { ok: 'OK', warn: 'HINWEIS', fail: 'FEHLER', info: 'INFO' };
    var row = document.createElement('div');
    row.className = 'cfg-row ' + (level || 'info');
    row.innerHTML =
      '<span class="cfg-name">' + escapeHtml(name) + '</span>' +
      '<span class="cfg-value">' + escapeHtml(value == null ? '—' : value) + '</span>' +
      '<span class="cfg-status">' + escapeHtml(labels[level] || 'INFO') + '</span>' +
      (hint ? '<span class="cfg-hint">' + escapeHtml(hint) + '</span>' : '');
    container.appendChild(row);
    updateOverall();
  }

  function updateOverall() {
    var banner = $('overall');
    if (!banner) return;
    var cls = 'config-status ';
    var text;
    if (checksFailed > 0) {
      cls += 'fail';
      text = 'Diagnose: ' + checksFailed + ' Fehler, ' + checksWarned + ' Hinweis(e) in ' + checksTotal + ' Prüfungen – Details unten.';
    } else if (checksWarned > 0) {
      cls += 'warn';
      text = 'Diagnose: keine Fehler, aber ' + checksWarned + ' Hinweis(e) in ' + checksTotal + ' Prüfungen.';
    } else {
      cls += 'ok';
      text = 'Diagnose: alle ' + checksTotal + ' Prüfungen ohne Fehler.';
    }
    banner.className = cls;
    banner.textContent = text;
  }

  function clearRows(containerId) {
    var container = $(containerId);
    if (container) container.innerHTML = '';
  }

  function checkConfig() {
    var cfg = window.APP_CONFIG;
    if (!cfg || typeof cfg !== 'object') {
      addRow('cfg-config', 'config.js', 'nicht geladen', 'fail',
        'config.js fehlt, ist leer oder enthält einen Syntaxfehler (häufig: Komma statt Punkt bei Koordinaten).');
      return null;
    }
    addRow('cfg-config', 'config.js', 'geladen', 'ok');

    var lat = cfg.defaultLat;
    if (validCoordinate(Number(lat), -90, 90) && isFiniteNumber(Number(lat))) {
      addRow('cfg-config', 'defaultLat', String(lat), 'ok');
    } else {
      addRow('cfg-config', 'defaultLat', String(lat), 'fail',
        'Breite muss eine Zahl zwischen -90 und 90 sein (Dezimalpunkt, z. B. 53.3513).');
    }

    var lng = cfg.defaultLng;
    if (validCoordinate(Number(lng), -180, 180) && isFiniteNumber(Number(lng))) {
      addRow('cfg-config', 'defaultLng', String(lng), 'ok');
    } else {
      addRow('cfg-config', 'defaultLng', String(lng), 'fail',
        'Länge muss eine Zahl zwischen -180 und 180 sein (Dezimalpunkt, z. B. 7.1806).');
    }

    var fuel = cfg.defaultFuel;
    if (FUEL_TYPES.indexOf(fuel) !== -1) {
      addRow('cfg-config', 'defaultFuel', String(fuel), 'ok');
    } else {
      addRow('cfg-config', 'defaultFuel', String(fuel), 'fail',
        'Erlaubt sind nur: diesel, e5, e10.');
    }

    var radius = Number(cfg.defaultRadiusKm);
    if (isFiniteNumber(radius) && radius > 0 && radius <= 200) {
      addRow('cfg-config', 'defaultRadiusKm', String(cfg.defaultRadiusKm), 'ok');
    } else {
      addRow('cfg-config', 'defaultRadiusKm', String(cfg.defaultRadiusKm), 'fail',
        'Umkreis muss eine Zahl zwischen 1 und 200 (km) sein.');
    }
    return cfg;
  }

  function getConfigLocation(cfg) {
    if (cfg && validCoordinate(Number(cfg.defaultLat), -90, 90) &&
        validCoordinate(Number(cfg.defaultLng), -180, 180)) {
      return { lat: Number(cfg.defaultLat), lng: Number(cfg.defaultLng) };
    }
    return DEFAULT_LOCATION;
  }

  function checkCoverage(stations, originLabel) {
    var cfg = window.APP_CONFIG;
    var origin = getConfigLocation(cfg);
    var radius = Number(cfg && cfg.defaultRadiusKm) > 0 ? Number(cfg.defaultRadiusKm) : null;
    addRow('cfg-coverage', originLabel || 'Standard-Standort',
      origin.lat + ', ' + origin.lng, 'info');
    addRow('cfg-coverage', 'Umkreis-Filter', radius !== null ? radius + ' km' : 'aus', 'info');

    if (!stations.length) {
      addRow('cfg-coverage', 'Abdeckung', 'keine Stationen', 'fail',
        'Ohne gültige Stationen kann nichts angezeigt werden – Abschnitt 2 beachten.');
      return;
    }

    var nearest = null;
    var inRadius = 0;
    stations.forEach(function (station) {
      var distance = haversineDistanceKm(origin, station);
      if (radius !== null && distance <= radius) inRadius += 1;
      if (!nearest || distance < nearest.distance) {
        nearest = { distance: distance, name: station.name || station.brand || 'Tankstelle' };
      }
    });

    addRow('cfg-coverage', 'Stationen im Umkreis', String(inRadius), inRadius > 0 ? 'ok' : 'fail',
      inRadius > 0 ? '' : 'Der Standort liegt außerhalb der geladenen Daten (nächste Station: ' +
        Math.round(nearest.distance) + ' km). Ursache: Die Region wurde noch nicht in den Daten-Workflow '
        + 'aufgenommen bzw. dieser hat noch keine frischen Daten geliefert (siehe Abschnitt 4). '
        + 'Übergangsweise den Umkreis stark erhöhen oder Standort in config.js anpassen.');

    addRow('cfg-coverage', 'Nächste Station',
      Math.round(nearest.distance) + ' km – ' + nearest.name,
      nearest.distance <= (radius || 25) ? 'ok' : 'warn');
  }

  function checkData() {
    fetch('data/prices.json', { cache: 'no-store' })
      .then(function (response) {
        var lastModified = response.headers.get('last-modified');
        if (!response.ok) {
          addRow('cfg-data', 'HTTP-Status', String(response.status), 'fail',
            'prices.json ist nicht erreichbar (404 = Datei fehlt im Repository oder falscher Pfad).');
          checkCoverage([]);
          return null;
        }
        addRow('cfg-data', 'HTTP-Status', 'OK (' + response.status + ')', 'ok');
        return response.json().then(function (data) {
          return { data: data, lastModified: lastModified };
        }, function (error) {
          addRow('cfg-data', 'JSON-Format', 'ungültig', 'fail', 'Antwort ist kein gültiges JSON: ' + error);
          checkCoverage([]);
          return null;
        });
      })
      .then(function (result) {
        if (!result) return;
        var data = result.data;
        if (!data || !Array.isArray(data.stations)) {
          addRow('cfg-data', 'Format', 'erwartet { "stations": [ … ] }', 'fail',
            'Das Root-Objekt mit einem stations-Array fehlt.');
          checkCoverage([]);
          return;
        }
        var valid = data.stations.filter(isValidStation);
        addRow('cfg-data', 'Stationen',
          valid.length + ' von ' + data.stations.length + ' gültig',
          valid.length > 0 ? 'ok' : 'fail',
          valid.length > 0 ? '' : 'Jeder Eintrag braucht lat/lng und mindestens einen Preis (diesel/e5/e10 > 0).');

        var timestamp = parseDate(data.fetched_at) || parseDate(result.lastModified);
        if (timestamp) {
          var ageHours = (Date.now() - timestamp.getTime()) / 3600000;
          var level = ageHours <= 2 ? 'ok' : (ageHours <= 24 ? 'warn' : 'fail');
          var hint = level === 'ok' ? '' :
            'Daten sind veraltet – der Workflow „Update Sprit Prices“ liefert keine frischen Daten '
            + '(häufig: Secret TANKERKOENIG_KEY falsch/fehlt oder Action deaktiviert).';
          addRow('cfg-data', 'Stand der Daten',
            formatDateTime(timestamp) + ' (vor ' + formatAge(ageHours) + ')', level, hint);
        } else {
          addRow('cfg-data', 'Stand der Daten', 'unbekannt', 'warn',
            'Kein Zeitstempel vorhanden – erscheint automatisch nach dem nächsten Workflow-Lauf.');
        }
        checkCoverage(valid);
      })
      .catch(function (error) {
        addRow('cfg-data', 'Laden', 'fehlgeschlagen', 'fail', 'prices.json konnte nicht geladen werden: ' + error);
        checkCoverage([]);
      });
  }

  function coverageFromPosition(position) {
    var coords = position && position.coords;
    if (!coords) return;
    var origin = { lat: coords.latitude, lng: coords.longitude };
    var stations = window.__cfgStations || [];
    var radius = Number(window.APP_CONFIG && window.APP_CONFIG.defaultRadiusKm) > 0
      ? Number(window.APP_CONFIG.defaultRadiusKm) : null;
    addRow('cfg-geo', 'Aktuelle Position', origin.lat + ', ' + origin.lng, 'ok');
    if (radius === null) {
      addRow('cfg-geo', 'Abdeckung', 'kein Umkreis gesetzt', 'info');
      return;
    }
    var inRadius = 0;
    var nearest = null;
    stations.forEach(function (station) {
      var distance = haversineDistanceKm(origin, station);
      if (distance <= radius) inRadius += 1;
      if (!nearest || distance < nearest) nearest = distance;
    });
    addRow('cfg-geo', 'Stationen im Umkreis von ' + radius + ' km', String(inRadius),
      inRadius > 0 ? 'ok' : 'fail',
      inRadius > 0 ? '' : 'An dieser Position liegen keine geladenen Stationen im Umkreis '
        + '(nächste: ' + Math.round(nearest) + ' km).');
  }

  function bindGeoTest() {
    var button = $('geo-test');
    if (!button) return;
    button.addEventListener('click', function () {
      clearRows('cfg-geo');
      if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
        addRow('cfg-geo', 'Geolocation', 'nicht verfügbar', 'fail',
          'Der Browser unterstützt keine Standortbestimmung.');
        return;
      }
      addRow('cfg-geo', 'Position', 'wird ermittelt …', 'info');
      navigator.geolocation.getCurrentPosition(coverageFromPosition, function (error) {
        addRow('cfg-geo', 'Geolocation-Fehler', error.code + ': ' + error.message, 'fail',
          'Position freigeben (Browser-Adressleiste) oder Standortdienste prüfen.');
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });
  }

  function checkWorkflow() {
    var slug = getRepoSlug();
    var url = 'https://api.github.com/repos/' + slug + '/actions/workflows/' + WORKFLOW_FILE + '/runs?per_page=5';
    fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var runs = (data.workflow_runs || []).slice(0, 5);
        if (!runs.length) {
          addRow('cfg-workflow', 'Workflow-Läufe', 'keine gefunden', 'warn',
            'Workflow noch nie gelaufen – im Repository-Tab „Actions“ manuell starten (Run workflow).');
          return;
        }
        var failureCount = 0;
        runs.forEach(function (run) {
          var failed = run.conclusion === 'failure';
          if (failed) failureCount += 1;
          addRow('cfg-workflow', formatDateTime(parseDate(run.created_at) || new Date()),
            (run.conclusion || run.status || 'unbekannt') + (failed ? ' – bitte prüfen' : ''),
            failed ? 'fail' : (run.conclusion === 'success' ? 'ok' : 'info'),
            failed ? 'Der Daten-Update schlägt fehl – meist ist das Secret TANKERKOENIG_KEY falsch oder fehlt.' : '');
        });
        if (failureCount > 0) {
          addRow('cfg-workflow', 'TANKERKOENIG_KEY', 'vermutlich fehlerhaft', 'fail',
            'Settings → Secrets and variables → Actions → TANKERKOENIG_KEY mit dem Key von '
            + 'creativecommons.tankerkoenig.de aktualisieren, danach den Workflow erneut starten.');
        }
      })
      .catch(function (error) {
        addRow('cfg-workflow', 'GitHub-API', 'nicht erreichbar', 'warn',
          'Status bitte manuell im Actions-Tab prüfen (' + error + ').');
      });
  }

  function bindKeyTest() {
    var button = $('key-test');
    var input = $('tankerkoenig-key');
    if (!button || !input) return;
    button.addEventListener('click', function () {
      clearRows('cfg-key');
      clearRows('cfg-key-link');
      var key = input.value.trim();
      if (!key) {
        addRow('cfg-key', 'API-Key', 'leer', 'fail', 'Bitte einen Key eingeben.');
        return;
      }
      button.disabled = true;
      addRow('cfg-key', 'Test', 'Anfrage an tankerkönig.de läuft …', 'info');
      var origin = getConfigLocation(window.APP_CONFIG);
      var url = API_BASE + '?lat=' + origin.lat + '&lng=' + origin.lng
        + '&rad=2&sort=dist&type=all&apikey=' + encodeURIComponent(key);
      fetch(url)
        .then(function (response) {
          return response.json().then(function (data) {
            return { status: response.status, data: data };
          });
        })
        .then(function (result) {
          if (result.data && result.data.ok === true) {
            var count = result.data.stations ? result.data.stations.length : 0;
            addRow('cfg-key', 'API-Key', 'gültig', 'ok',
              'Testabfrage erfolgreich – ' + count + ' Stationen gefunden. '
              + 'Der Key ist korrekt und gehört nur ins GitHub-Secret TANKERKOENIG_KEY.');
          } else {
            var message = result.data && result.data.message ? result.data.message : 'HTTP ' + result.status;
            addRow('cfg-key', 'API-Key', 'ungültig', 'fail',
              'Antwort der API: „' + message + '“ – Key prüfen oder bei tankerkönig.de neu generieren.');
          }
        })
        .catch(function () {
          addRow('cfg-key', 'API-Key', 'manuell prüfen', 'warn',
            'Der direkte Test wurde vom Browser blockiert (CORS/Netzwerk). Link öffnen – '
            + 'korrekt ist die Antwort, wenn darin „ok\": true steht.');
          var linkHost = $('cfg-key-link');
          if (linkHost) {
            var link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'cfg-test-link';
            link.textContent = 'Test-URL in neuem Tab öffnen';
            linkHost.appendChild(link);
          }
        })
        .then(function () {
          button.disabled = false;
        });
    });
  }

  // Stationen fuer den Geolocation-Test cachen (ohne globales Proxy im Strict Mode):
  function cacheStations(stations) {
    window.__cfgStations = stations;
  }

  function init() {
    checkConfig();
    bindGeoTest();
    bindKeyTest();
    checkWorkflow();
    // Stationen cachen, damit der Geo-Test die Abdeckung live pruefen kann:
    fetch('data/prices.json', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.stations)) {
          cacheStations(data.stations.filter(isValidStation));
        }
      })
      .catch(function () { /* wird bereits in checkData gemeldet */ });
    checkData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
