"""Le soglie di tempo della Baracca, in un posto solo. Le usano gli hook, il
server e (via /api/config, vedi server.config_payload) la pagina: prima gli
stessi numeri erano scritti a mano in quattro file.

Tutte in millisecondi, come i ts scritti dagli hook."""

MINUTO_MS = 60 * 1000

# uno stato thinking/waiting/spawning più vecchio di così è una sessione morta
# a metà turno (non ha mai scritto idle): il server lo serve come idle
STATO_FERMO_MS = 10 * MINUTO_MS

# senza eventi da così tanto la pagina lascia il LIVE e torna alla DEMO, e un
# terminale sparisce dalla scena
LIVE_MS = 15 * MINUTO_MS

# un sub-agente senza SubagentStop da così tanto non è più in scena
SUBAGENTE_MS = 20 * MINUTO_MS

# oltre, sessioni e coda dei sub-agenti si tolgono anche dai file locali
CONSERVA_MS = 60 * MINUTO_MS

# una riga PreToolUse più vecchia di così non è più reclamabile da SubagentStart
CLAIM_WINDOW_S = 60


def per_la_pagina():
    """Le soglie che servono anche al JS della pagina."""
    return {"live_ms": LIVE_MS, "subagente_ms": SUBAGENTE_MS}
