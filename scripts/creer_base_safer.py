#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Création complète de la base de données SAFER à partir du site https://www.le-prix-des-terres.fr.

Le script :
  1. Scrappe les données « Terres et prés » pour chaque département métropolitain.
  2. Scrappe les données « Forêts » pour chaque région forestière et les associe aux communes.
  3. Fusionne les informations par commune (code INSEE) en consolidant les prix terre/forêt.
  4. Construit une base SQLite `safer_prices.db` contenant la table `safer_prices` et une table `meta`.

Le processus complet demande 20 à 30 minutes en fonction de la connexion.
"""

import json
import re
import sqlite3
import time
import unicodedata
from collections import namedtuple
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import requests
from requests import Response
from urllib.parse import quote


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "safer_prices.db"

BASE_TERRE_URL = "https://www.le-prix-des-terres.fr/carte/terre"
BASE_FORET_URL = "https://www.le-prix-des-terres.fr/carte/foret"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


# Compatible avec Python < 3.7 : utilisation d'un namedtuple au lieu de dataclass
Departement = namedtuple("Departement", ["code", "nom", "region_url", "nom_url"])


# Liste complète des départements métropolitains supportés par le site
DEPARTEMENTS: Sequence[Departement] = (
    Departement("01", "Ain", "Auvergne-Rhône-Alpes", "Ain"),
    Departement("02", "Aisne", "Hauts-de-France", "Aisne"),
    Departement("03", "Allier", "Auvergne-Rhône-Alpes", "Allier"),
    Departement("04", "Alpes-de-Haute-Provence", "Provence-Alpes-Côte d'Azur", "Alpes-de-Haute-Provence"),
    Departement("05", "Hautes-Alpes", "Provence-Alpes-Côte d'Azur", "Hautes-Alpes"),
    Departement("06", "Alpes-Maritimes", "Provence-Alpes-Côte d'Azur", "Alpes-Maritimes"),
    Departement("07", "Ardèche", "Auvergne-Rhône-Alpes", "Ardèche"),
    Departement("08", "Ardennes", "Grand Est", "Ardennes"),
    Departement("09", "Ariège", "Occitanie", "Ariège"),
    Departement("10", "Aube", "Grand Est", "Aube"),
    Departement("11", "Aude", "Occitanie", "Aude"),
    Departement("12", "Aveyron", "Occitanie", "Aveyron"),
    Departement("13", "Bouches-du-Rhône", "Provence-Alpes-Côte d'Azur", "Bouches-du-Rhône"),
    Departement("14", "Calvados", "Normandie", "Calvados"),
    Departement("15", "Cantal", "Auvergne-Rhône-Alpes", "Cantal"),
    Departement("16", "Charente", "Nouvelle-Aquitaine", "Charente"),
    Departement("17", "Charente-Maritime", "Nouvelle-Aquitaine", "Charente-Maritime"),
    Departement("18", "Cher", "Centre-Val de Loire", "Cher"),
    Departement("19", "Corrèze", "Nouvelle-Aquitaine", "Corrèze"),
    Departement("21", "Côte-d'Or", "Bourgogne-Franche-Comté", "Côte-d'Or"),
    Departement("22", "Côtes-d'Armor", "Bretagne", "Côtes-d'Armor"),
    Departement("23", "Creuse", "Nouvelle-Aquitaine", "Creuse"),
    Departement("24", "Dordogne", "Nouvelle-Aquitaine", "Dordogne"),
    Departement("25", "Doubs", "Bourgogne-Franche-Comté", "Doubs"),
    Departement("26", "Drôme", "Auvergne-Rhône-Alpes", "Drôme"),
    Departement("27", "Eure", "Normandie", "Eure"),
    Departement("28", "Eure-et-Loir", "Centre-Val de Loire", "Eure-et-Loir"),
    Departement("29", "Finistère", "Bretagne", "Finistère"),
    Departement("30", "Gard", "Occitanie", "Gard"),
    Departement("31", "Haute-Garonne", "Occitanie", "Haute-Garonne"),
    Departement("32", "Gers", "Occitanie", "Gers"),
    Departement("33", "Gironde", "Nouvelle-Aquitaine", "Gironde"),
    Departement("34", "Hérault", "Occitanie", "Hérault"),
    Departement("35", "Ille-et-Vilaine", "Bretagne", "Ille-et-Vilaine"),
    Departement("36", "Indre", "Centre-Val de Loire", "Indre"),
    Departement("37", "Indre-et-Loire", "Centre-Val de Loire", "Indre-et-Loire"),
    Departement("38", "Isère", "Auvergne-Rhône-Alpes", "Isère"),
    Departement("39", "Jura", "Bourgogne-Franche-Comté", "Jura"),
    Departement("40", "Landes", "Nouvelle-Aquitaine", "Landes"),
    Departement("41", "Loir-et-Cher", "Centre-Val de Loire", "Loir-et-Cher"),
    Departement("42", "Loire", "Auvergne-Rhône-Alpes", "Loire"),
    Departement("43", "Haute-Loire", "Auvergne-Rhône-Alpes", "Haute-Loire"),
    Departement("44", "Loire-Atlantique", "Pays de la Loire", "Loire-Atlantique"),
    Departement("45", "Loiret", "Centre-Val de Loire", "Loiret"),
    Departement("46", "Lot", "Occitanie", "Lot"),
    Departement("47", "Lot-et-Garonne", "Nouvelle-Aquitaine", "Lot-et-Garonne"),
    Departement("48", "Lozère", "Occitanie", "Lozère"),
    Departement("49", "Maine-et-Loire", "Pays de la Loire", "Maine-et-Loire"),
    Departement("50", "Manche", "Normandie", "Manche"),
    Departement("51", "Marne", "Grand Est", "Marne"),
    Departement("52", "Haute-Marne", "Grand Est", "Haute-Marne"),
    Departement("53", "Mayenne", "Pays de la Loire", "Mayenne"),
    Departement("54", "Meurthe-et-Moselle", "Grand Est", "Meurthe-et-Moselle"),
    Departement("55", "Meuse", "Grand Est", "Meuse"),
    Departement("56", "Morbihan", "Bretagne", "Morbihan"),
    Departement("57", "Moselle", "Grand Est", "Moselle"),
    Departement("58", "Nièvre", "Bourgogne-Franche-Comté", "Nièvre"),
    Departement("59", "Nord", "Hauts-de-France", "Nord"),
    Departement("60", "Oise", "Hauts-de-France", "Oise"),
    Departement("61", "Orne", "Normandie", "Orne"),
    Departement("62", "Pas-de-Calais", "Hauts-de-France", "Pas-de-Calais"),
    Departement("63", "Puy-de-Dôme", "Auvergne-Rhône-Alpes", "Puy-de-Dôme"),
    Departement("64", "Pyrénées-Atlantiques", "Nouvelle-Aquitaine", "Pyrénées-Atlantiques"),
    Departement("65", "Hautes-Pyrénées", "Occitanie", "Hautes-Pyrénées"),
    Departement("66", "Pyrénées-Orientales", "Occitanie", "Pyrénées-Orientales"),
    Departement("67", "Bas-Rhin", "Grand Est", "Bas-Rhin"),
    Departement("68", "Haut-Rhin", "Grand Est", "Haut-Rhin"),
    Departement("69", "Rhône", "Auvergne-Rhône-Alpes", "Rhône"),
    Departement("70", "Haute-Saône", "Bourgogne-Franche-Comté", "Haute-Saône"),
    Departement("71", "Saône-et-Loire", "Bourgogne-Franche-Comté", "Saône-et-Loire"),
    Departement("72", "Sarthe", "Pays de la Loire", "Sarthe"),
    Departement("73", "Savoie", "Auvergne-Rhône-Alpes", "Savoie"),
    Departement("74", "Haute-Savoie", "Auvergne-Rhône-Alpes", "Haute-Savoie"),
    Departement("75", "Paris", "Île-de-France", "Paris"),
    Departement("76", "Seine-Maritime", "Normandie", "Seine-Maritime"),
    Departement("77", "Seine-et-Marne", "Île-de-France", "Seine-et-Marne"),
    Departement("78", "Yvelines", "Île-de-France", "Yvelines"),
    Departement("79", "Deux-Sèvres", "Nouvelle-Aquitaine", "Deux-Sèvres"),
    Departement("80", "Somme", "Hauts-de-France", "Somme"),
    Departement("81", "Tarn", "Occitanie", "Tarn"),
    Departement("82", "Tarn-et-Garonne", "Occitanie", "Tarn-et-Garonne"),
    Departement("83", "Var", "Provence-Alpes-Côte d'Azur", "Var"),
    Departement("84", "Vaucluse", "Provence-Alpes-Côte d'Azur", "Vaucluse"),
    Departement("85", "Vendée", "Pays de la Loire", "Vendée"),
    Departement("86", "Vienne", "Nouvelle-Aquitaine", "Vienne"),
    Departement("87", "Haute-Vienne", "Nouvelle-Aquitaine", "Haute-Vienne"),
    Departement("88", "Vosges", "Grand Est", "Vosges"),
    Departement("89", "Yonne", "Bourgogne-Franche-Comté", "Yonne"),
    Departement("90", "Territoire de Belfort", "Bourgogne-Franche-Comté", "Territoire de Belfort"),
    Departement("91", "Essonne", "Île-de-France", "Essonne"),
    Departement("92", "Hauts-de-Seine", "Île-de-France", "Hauts-de-Seine"),
    Departement("93", "Seine-Saint-Denis", "Île-de-France", "Seine-Saint-Denis"),
    Departement("94", "Val-de-Marne", "Île-de-France", "Val-de-Marne"),
    Departement("95", "Val-d'Oise", "Île-de-France", "Val-d'Oise"),
)


class ScraperError(Exception):
    """Erreur remontée lors du scraping."""


def telecharger_page(url: str, max_retries: int = 4, pause_s: float = 2.0) -> Optional[str]:
    """Télécharge une page en gérant les erreurs réseau et les retries."""

    for tentative in range(1, max_retries + 1):
        try:
            response: Response = requests.get(url, headers=HEADERS, timeout=30)
            response.raise_for_status()
            return response.text
        except (requests.Timeout, requests.ConnectionError):
            if tentative == max_retries:
                return None
            time.sleep(pause_s * tentative)
        except requests.HTTPError as exc:
            # Les erreurs 500 surviennent régulièrement : on retente.
            if response.status_code >= 500 and tentative < max_retries:
                time.sleep(pause_s * tentative)
                continue
            raise ScraperError(f"HTTP {response.status_code} pour {url}") from exc
    return None


def extraire_page_js(html: Optional[str]) -> Optional[Dict]:
    """Extrait l'objet JavaScript `page` depuis le HTML de la page."""

    if not html:
        return None
    match = re.search(r"var page = ({.+?});", html, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def parse_float(value: Optional[str]) -> Optional[float]:
    if value in (None, "", "-"):
        return None
    cleaned = (
        str(value)
        .replace("\xa0", "")
        .replace(" ", "")
        .replace("€", "")
        .replace(",", ".")
        .strip()
    )
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_int(value: Optional[str]) -> Optional[int]:
    if value in (None, "", "-"):
        return None
    cleaned = str(value).replace(" ", "").strip()
    if not cleaned:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def normalize_text(value: str) -> str:
    """Normalise un libellé pour fiabiliser les correspondances."""

    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("-", " ").replace("'", " ").replace("’", " ")
    text = re.sub(r"\s+", " ", text).strip().casefold()
    return text


def commune_key(code: Optional[str], name: str) -> Tuple[str, str]:
    return ((code or "").strip(), normalize_text(name))


def construire_url_terre(dept: Departement, petite_region: Optional[str] = None) -> str:
    region = quote(dept.region_url)
    departement = quote(dept.nom_url)
    if petite_region:
        return f"{BASE_TERRE_URL}/{region}/{departement}/{quote(petite_region)}/"
    return f"{BASE_TERRE_URL}/{region}/{departement}/"


def construire_url_foret(region: Optional[str] = None) -> str:
    if region:
        return f"{BASE_FORET_URL}/{quote(region)}/"
    return f"{BASE_FORET_URL}/"


def collecter_petites_regions(dept: Departement) -> List[Dict]:
    url = construire_url_terre(dept)
    page = extraire_page_js(telecharger_page(url))
    if not page:
        raise ScraperError(f"Impossible de récupérer les petites régions pour {dept.nom}")

    resultats: List[Dict] = []
    for geo in page.get("geodatas", []):
        datas = geo.get("datas")
        if not isinstance(datas, list):
            continue
        for zone in datas:
            if zone.get("level") != 3:
                continue
            resultats.append(zone)
    return resultats


def collecter_communes_terre(dept: Departement, petite_region_nom: str) -> List[Dict]:
    url = construire_url_terre(dept, petite_region_nom)
    page = extraire_page_js(telecharger_page(url))
    if not page:
        raise ScraperError(
            f"Impossible de récupérer les communes de la petite région '{petite_region_nom}' ({dept.nom})"
        )

    communes: List[Dict] = []
    for geo in page.get("geodatas", []):
        datas = geo.get("datas")
        if not isinstance(datas, list):
            continue
        communes.extend(datas)
    return communes


def collecter_regions_foret() -> List[Dict]:
    page = extraire_page_js(telecharger_page(construire_url_foret()))
    if not page:
        raise ScraperError("Impossible de récupérer la liste des régions forestières")

    regions: List[Dict] = []
    for geo in page.get("geodatas", []):
        datas = geo.get("datas")
        if not isinstance(datas, list):
            continue
        regions.extend(datas)
    return regions


def collecter_communes_foret(region_nom: str) -> List[Dict]:
    page = extraire_page_js(telecharger_page(construire_url_foret(region_nom)))
    if not page:
        raise ScraperError(f"Impossible de récupérer les communes pour la région forestière '{region_nom}'")

    communes: List[Dict] = []
    for geo in page.get("geodatas", []):
        datas = geo.get("datas")
        if not isinstance(datas, list):
            continue
        communes.extend(datas)
    return communes


def construire_code_insee(dept_code: str, commune_code: Optional[str]) -> Optional[str]:
    if not commune_code:
        return None
    commune_code = commune_code.strip()
    if not commune_code:
        return None
    return f"{dept_code}{commune_code}"


def collecter_donnees_terres() -> Tuple[Dict[str, Dict], Dict[Tuple[str, str], Set[str]], Dict[str, Set[str]]]:
    """Collecte les données terres et construit les index de correspondance."""

    donnees: Dict[str, Dict] = {}
    index_code_nom: Dict[Tuple[str, str], Set[str]] = {}
    index_nom: Dict[str, Set[str]] = {}

    print("================ TERRES ET PRÉS ================")
    for idx, dept in enumerate(DEPARTEMENTS, start=1):
        print(f"[{idx:02}/{len(DEPARTEMENTS)}] {dept.code} - {dept.nom}")
        try:
            petites_regions = collecter_petites_regions(dept)
        except ScraperError as exc:
            print(f"   [ERREUR] {exc}")
            continue

        for petite in petites_regions:
            petite_nom = petite.get("name") or ""
            petites_code = petite.get("code") or ""
            prix_libre = parse_float(petite.get("datas", {}).get("prix_libre"))
            annee = parse_int(petite.get("datas", {}).get("annee"))

            try:
                communes = collecter_communes_terre(dept, petite_nom)
            except ScraperError as exc:
                print(f"      [ERREUR] {exc}")
                continue

            print(f"      [OK] {petite_nom} : {len(communes)} communes")

            for commune in communes:
                nom_commune = commune.get("name")
                code_commune = commune.get("code")
                if not nom_commune or not code_commune:
                    continue

                code_insee = construire_code_insee(dept.code, code_commune)
                if not code_insee:
                    continue

                key = commune_key(code_commune, nom_commune)
                index_code_nom.setdefault(key, set()).add(code_insee)
                index_nom.setdefault(key[1], set()).add(code_insee)

                donnees[code_insee] = {
                    "code_insee": code_insee,
                    "departement_code": dept.code,
                    "departement_nom": dept.nom,
                    "commune_nom": nom_commune,
                    "petite_region_nom": petite_nom,
                    "petite_region_code": petites_code,
                    "prix_terre_ha": prix_libre,
                    "annee_terre": annee,
                    "nombre_ventes_terre": parse_int(commune.get("datas", {}).get("nombre_ventes")),
                    "source_terre_url": construire_url_terre(dept, petite_nom),
                }

            time.sleep(0.3)

        # Pause légère entre départements pour limiter la charge
        time.sleep(0.5)

    print(f"   --> Communes total TERRES: {len(donnees):,}")
    return donnees, index_code_nom, index_nom


def collecter_donnees_forets(
    index_code_nom: Dict[Tuple[str, str], Set[str]],
    index_nom: Dict[str, Set[str]],
) -> Tuple[Dict[str, Dict], List[Dict]]:
    """Collecte les données forêts et les rattache aux communes via les index."""

    donnees: Dict[str, Dict] = {}
    manquantes: List[Dict] = []

    print("\n================ FORÊTS ================")
    try:
        regions = collecter_regions_foret()
    except ScraperError as exc:
        print(f"[ERREUR] {exc}")
        return donnees, manquantes

    for region in regions:
        nom_region = region.get("name") or ""
        if not nom_region:
            continue

        prix_foret = parse_float(region.get("datas", {}).get("prix_foret"))
        annee = parse_int(region.get("datas", {}).get("annee"))

        try:
            communes = collecter_communes_foret(nom_region)
        except ScraperError as exc:
            print(f"   [ERREUR] {exc}")
            continue

        print(f"   [FORET] {nom_region} : {len(communes)} communes")

        for commune in communes:
            nom_commune = commune.get("name")
            code_commune = commune.get("code")
            if not nom_commune:
                continue

            key = commune_key(code_commune, nom_commune)
            matches = index_code_nom.get(key)

            if not matches:
                # Fallback sur le nom seul
                matches = index_nom.get(key[1])

            if not matches:
                manquantes.append({
                    "region": nom_region,
                    "commune": nom_commune,
                    "code": code_commune,
                })
                continue

            if len(matches) > 1:
                # Ambiguïté rare : on journalise mais on associe toutes les communes concernées
                print(
                    f"      [ATTENTION] Ambiguïté pour {nom_commune} ({code_commune}) : {len(matches)} communes"
                )

            for code_insee in matches:
                donnees[code_insee] = {
                    "code_insee": code_insee,
                    "region_forestiere": nom_region,
                    "prix_foret_ha": prix_foret,
                    "annee_foret": annee,
                    "nombre_ventes_foret": parse_int(
                        commune.get("datas", {}).get("nombre_ventes")
                    ),
                    "source_foret_url": construire_url_foret(nom_region),
                }

        time.sleep(0.5)

    print(f"   --> Communes associées FORÊTS: {len(donnees):,}")
    if manquantes:
        print(f"   [ATTENTION] Communes sans correspondance: {len(manquantes)}")
    return donnees, manquantes


def fusionner_donnees(
    terres: Dict[str, Dict],
    forets: Dict[str, Dict],
    manquantes_forets: Sequence[Dict],
) -> List[Dict]:
    """Fusionne les données terre et forêt par code INSEE."""

    fusion: List[Dict] = []

    for code_insee, terre in terres.items():
        base = terre.copy()
        foret = forets.get(code_insee)
        if foret:
            base.update({
                "region_forestiere": foret.get("region_forestiere"),
                "prix_foret_ha": foret.get("prix_foret_ha"),
                "annee_foret": foret.get("annee_foret"),
                "nombre_ventes_foret": foret.get("nombre_ventes_foret"),
                "source_foret_url": foret.get("source_foret_url"),
            })
        else:
            base.update({
                "region_forestiere": None,
                "prix_foret_ha": None,
                "annee_foret": None,
                "nombre_ventes_foret": None,
                "source_foret_url": None,
            })
        fusion.append(base)

    # Ajouter les communes forêt qui n'existent pas côté terres (très peu probable)
    for code_insee, foret in forets.items():
        if code_insee in terres:
            continue
        base = {
            "code_insee": code_insee,
            "departement_code": None,
            "departement_nom": None,
            "commune_nom": None,
            "petite_region_nom": None,
            "petite_region_code": None,
            "prix_terre_ha": None,
            "annee_terre": None,
            "nombre_ventes_terre": None,
            "source_terre_url": None,
            "region_forestiere": foret.get("region_forestiere"),
            "prix_foret_ha": foret.get("prix_foret_ha"),
            "annee_foret": foret.get("annee_foret"),
            "nombre_ventes_foret": foret.get("nombre_ventes_foret"),
            "source_foret_url": foret.get("source_foret_url"),
        }
        fusion.append(base)

    fusion.sort(key=lambda item: (item.get("departement_nom") or "", item.get("commune_nom") or ""))
    return fusion


def creer_base_sqlite(donnees: Sequence[Dict], manquantes_forets: Sequence[Dict]) -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute(
            """
            CREATE TABLE safer_prices (
                code_insee TEXT PRIMARY KEY,
                departement_code TEXT,
                departement_nom TEXT,
                commune_nom TEXT,
                petite_region_nom TEXT,
                petite_region_code TEXT,
                prix_terre_ha REAL,
                annee_terre INTEGER,
                nombre_ventes_terre INTEGER,
                region_forestiere TEXT,
                prix_foret_ha REAL,
                annee_foret INTEGER,
                nombre_ventes_foret INTEGER,
                source_terre_url TEXT,
                source_foret_url TEXT,
                created_at TEXT NOT NULL
            );
            """
        )

        conn.execute(
            """
            CREATE TABLE meta (
                cle TEXT PRIMARY KEY,
                valeur TEXT NOT NULL
            );
            """
        )

        now_iso = datetime.utcnow().isoformat(timespec="seconds") + "Z"

        with conn:
            conn.executemany(
                """
                INSERT INTO safer_prices (
                    code_insee,
                    departement_code,
                    departement_nom,
                    commune_nom,
                    petite_region_nom,
                    petite_region_code,
                    prix_terre_ha,
                    annee_terre,
                    nombre_ventes_terre,
                    region_forestiere,
                    prix_foret_ha,
                    annee_foret,
                    nombre_ventes_foret,
                    source_terre_url,
                    source_foret_url,
                    created_at
                ) VALUES (
                    :code_insee,
                    :departement_code,
                    :departement_nom,
                    :commune_nom,
                    :petite_region_nom,
                    :petite_region_code,
                    :prix_terre_ha,
                    :annee_terre,
                    :nombre_ventes_terre,
                    :region_forestiere,
                    :prix_foret_ha,
                    :annee_foret,
                    :nombre_ventes_foret,
                    :source_terre_url,
                    :source_foret_url,
                    :created_at
                );
                """,
                [
                    {
                        **donnee,
                        "created_at": now_iso,
                    }
                    for donnee in donnees
                ],
            )

            conn.execute(
                "INSERT INTO meta (cle, valeur) VALUES (?, ?)",
                ("generated_at", now_iso),
            )

            conn.execute(
                "INSERT INTO meta (cle, valeur) VALUES (?, ?)",
                ("total_communes", str(len(donnees))),
            )

            conn.execute(
                "INSERT INTO meta (cle, valeur) VALUES (?, ?)",
                ("communes_foret_sans_match", str(len(manquantes_forets))),
            )

        conn.execute(
            "CREATE INDEX idx_safer_depart_commune ON safer_prices(departement_nom, commune_nom);"
        )
        conn.execute(
            "CREATE INDEX idx_safer_region_foret ON safer_prices(region_forestiere);"
        )
        conn.commit()
    finally:
        conn.close()


def afficher_bilan(donnees: Sequence[Dict]) -> None:
    total = len(donnees)
    with_terre = sum(1 for d in donnees if d.get("prix_terre_ha") is not None)
    with_foret = sum(1 for d in donnees if d.get("prix_foret_ha") is not None)

    print("\n================ BILAN ================")
    print(f"Communes totales : {total:,}")
    print(f"Prix TERRES dispo : {with_terre:,}")
    print(f"Prix FORÊTS dispo : {with_foret:,}")
    print(f"Base SQLite créée : {DB_PATH}")


def main() -> None:
    debut = time.time()

    terres, index_code_nom, index_nom = collecter_donnees_terres()
    forets, manquantes_forets = collecter_donnees_forets(index_code_nom, index_nom)

    donnees = fusionner_donnees(terres, forets, manquantes_forets)
    creer_base_sqlite(donnees, manquantes_forets)
    afficher_bilan(donnees)

    duree = int(time.time() - debut)
    print(f"Durée totale : {duree // 60} min {duree % 60} s")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterruption de l'utilisateur.")
    except ScraperError as exc:
        print(f"\n[ERREUR] Erreur critique : {exc}")
    except Exception as exc:  # pragma: no cover - log debug
        print(f"\n[ERREUR] Erreur inattendue : {exc}")


