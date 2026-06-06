import sqlite3
import hashlib
import json
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "motores.db"


def _connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ativos (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ativo_id    TEXT UNIQUE NOT NULL,
                descricao   TEXT,
                localizacao TEXT,
                criado_em   TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS leituras (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ativo_id        TEXT NOT NULL,
                fonte           TEXT DEFAULT 'esp32',
                temperatura_c   REAL,
                vibracao_mm_s   REAL,
                corrente_a      REAL,
                tensao_v        REAL,
                rpm             REAL,
                fator_potencia  REAL,
                coletado_em     TEXT,
                processado_em   TEXT DEFAULT (datetime('now')),
                flag_anomalia   INTEGER DEFAULT 0,
                hash_registro   TEXT,
                ax_rms          REAL,
                ay_rms          REAL,
                az_rms          REAL,
                mag_rms         REAL,
                freq_hz         REAL,
                gx_rms          REAL,
                gy_rms          REAL,
                gz_rms          REAL,
                peaks           TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_leituras_ativo
                ON leituras(ativo_id, coletado_em);
        """)


def cadastrar_ativo(ativo_id: str, descricao: str = "", localizacao: str = "") -> bool:
    """Insere ativo se não existir. Retorna True se criado, False se já existia."""
    with _connect() as conn:
        try:
            conn.execute(
                "INSERT INTO ativos (ativo_id, descricao, localizacao) VALUES (?, ?, ?)",
                (ativo_id, descricao, localizacao),
            )
            return True
        except sqlite3.IntegrityError:
            return False


def get_ativos() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM ativos ORDER BY criado_em").fetchall()
    return [dict(r) for r in rows]


def get_leituras(ativo_id: str | None = None, limit: int = 500) -> list[dict]:
    with _connect() as conn:
        if ativo_id:
            rows = conn.execute(
                "SELECT * FROM leituras WHERE ativo_id = ? ORDER BY coletado_em DESC LIMIT ?",
                (ativo_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM leituras ORDER BY coletado_em DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [dict(r) for r in rows]


def insert_leitura(ativo_id: str, dados: dict) -> int:
    payload = json.dumps({**dados, "ativo_id": ativo_id}, sort_keys=True, default=str)
    hash_reg = hashlib.sha256(payload.encode()).hexdigest()

    cols = [
        "ativo_id", "fonte", "temperatura_c", "vibracao_mm_s", "corrente_a",
        "tensao_v", "rpm", "fator_potencia", "coletado_em", "flag_anomalia",
        "hash_registro", "ax_rms", "ay_rms", "az_rms", "mag_rms",
        "freq_hz", "gx_rms", "gy_rms", "gz_rms", "peaks",
    ]
    values = [
        ativo_id,
        dados.get("fonte", "esp32"),
        dados.get("temperatura_c"),
        dados.get("vibracao_mm_s"),
        dados.get("corrente_a"),
        dados.get("tensao_v"),
        dados.get("rpm"),
        dados.get("fator_potencia"),
        dados.get("coletado_em", datetime.utcnow().isoformat()),
        dados.get("flag_anomalia", 0),
        hash_reg,
        dados.get("ax_rms"),
        dados.get("ay_rms"),
        dados.get("az_rms"),
        dados.get("mag_rms"),
        dados.get("freq_hz"),
        dados.get("gx_rms"),
        dados.get("gy_rms"),
        dados.get("gz_rms"),
        json.dumps(dados.get("peaks", [])),
    ]

    placeholders = ", ".join(["?"] * len(cols))
    col_names = ", ".join(cols)

    with _connect() as conn:
        cur = conn.execute(
            f"INSERT INTO leituras ({col_names}) VALUES ({placeholders})", values
        )
        return cur.lastrowid


def init_db_sprint3():
    """Tabelas novas do Sprint 3 — plantas, áreas, ativos industriais, logs."""
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS plantas (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                nome      TEXT UNIQUE NOT NULL,
                descricao TEXT,
                criado_em TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS areas (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                planta_id INTEGER NOT NULL REFERENCES plantas(id),
                nome      TEXT NOT NULL,
                descricao TEXT
            );

            CREATE TABLE IF NOT EXISTS ativos_industrial (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo               TEXT UNIQUE NOT NULL,
                tag                  TEXT,
                area_id              INTEGER REFERENCES areas(id),
                descricao            TEXT,
                fabricante           TEXT,
                potencia_kw          REAL,
                tensao_v             REAL,
                corrente_nom         REAL,
                ip_rating            TEXT,
                status               TEXT DEFAULT 'ativo',
                latitude             REAL,
                longitude            REAL,
                localizacao_descricao TEXT,
                data_install         TEXT,
                criado_em            TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS log_execucoes (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                automacao       TEXT,
                status          TEXT,
                registros_proc  INTEGER DEFAULT 0,
                registros_erro  INTEGER DEFAULT 0,
                detalhes        TEXT,
                iniciado_em     TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS historico_atualizacoes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                tabela      TEXT,
                operacao    TEXT,
                dados_antes TEXT,
                dados_depois TEXT,
                ts          TEXT DEFAULT (datetime('now'))
            );
        """)


# ── Consultas Sprint 3 ────────────────────────────────────────────────────────

def get_plantas():
    with _connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM plantas ORDER BY nome").fetchall()]


def get_areas(planta_id=None):
    with _connect() as conn:
        if planta_id:
            rows = conn.execute("SELECT * FROM areas WHERE planta_id=? ORDER BY nome", (planta_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM areas ORDER BY nome").fetchall()
        return [dict(r) for r in rows]


def get_ativos_industrial(area_id=None, status=None):
    with _connect() as conn:
        q = """SELECT a.*, ar.nome as area_nome, p.nome as planta_nome
               FROM ativos_industrial a
               LEFT JOIN areas ar ON a.area_id=ar.id
               LEFT JOIN plantas p ON ar.planta_id=p.id"""
        conds, params = [], []
        if area_id:
            conds.append("a.area_id=?"); params.append(area_id)
        if status:
            conds.append("a.status=?"); params.append(status)
        if conds:
            q += " WHERE " + " AND ".join(conds)
        q += " ORDER BY a.codigo"
        return [dict(r) for r in conn.execute(q, params).fetchall()]


def get_ativo_por_codigo(codigo):
    with _connect() as conn:
        row = conn.execute("""
            SELECT a.*, ar.nome as area_nome, p.nome as planta_nome, p.id as planta_id
            FROM ativos_industrial a
            LEFT JOIN areas ar ON a.area_id=ar.id
            LEFT JOIN plantas p ON ar.planta_id=p.id
            WHERE a.codigo=?
        """, (codigo,)).fetchone()
        return dict(row) if row else None


def criar_ativo_industrial(dados: dict):
    cols = ["codigo","tag","area_id","descricao","fabricante","potencia_kw",
            "tensao_v","corrente_nom","ip_rating","status","latitude","longitude",
            "localizacao_descricao","data_install"]
    vals = [dados.get(c) for c in cols]
    ph   = ",".join(["?"]*len(cols))
    with _connect() as conn:
        conn.execute(f"INSERT INTO ativos_industrial ({','.join(cols)}) VALUES ({ph})", vals)
        _log_hist(conn, "ativos_industrial", "INSERT", None, dados)


def editar_ativo_industrial(codigo: str, dados: dict):
    antes = get_ativo_por_codigo(codigo)
    campos = ["tag","area_id","descricao","fabricante","potencia_kw","tensao_v",
              "corrente_nom","ip_rating","status","latitude","longitude",
              "localizacao_descricao","data_install"]
    sets = ", ".join(f"{c}=?" for c in campos)
    vals = [dados.get(c) for c in campos] + [codigo]
    with _connect() as conn:
        conn.execute(f"UPDATE ativos_industrial SET {sets} WHERE codigo=?", vals)
        _log_hist(conn, "ativos_industrial", "UPDATE", antes, dados)


def log_execucao(automacao, status, proc=0, erros=0, detalhes=""):
    with _connect() as conn:
        conn.execute(
            "INSERT INTO log_execucoes (automacao,status,registros_proc,registros_erro,detalhes) VALUES (?,?,?,?,?)",
            (automacao, status, proc, erros, detalhes)
        )


def get_logs(limit=200):
    with _connect() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM log_execucoes ORDER BY iniciado_em DESC LIMIT ?", (limit,)
        ).fetchall()]


def get_historico(limit=200):
    with _connect() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM historico_atualizacoes ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()]


def _log_hist(conn, tabela, operacao, antes, depois):
    conn.execute(
        "INSERT INTO historico_atualizacoes (tabela,operacao,dados_antes,dados_depois) VALUES (?,?,?,?)",
        (tabela, operacao, json.dumps(antes, default=str), json.dumps(depois, default=str))
    )


init_db()
init_db_sprint3()
