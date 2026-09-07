# -*- coding: utf-8 -*-
"""
FORZY - Treino da rede neural de deteccao de anomalia (autoencoder).

Por que autoencoder e nao um classificador:
o dataset (data/forzy.csv -> data/forzy-data.js) nao tem rotulo. Ninguem marcou
"aqui quebrou". Entao nao da pra treinar supervisionado. O que da pra fazer, e o
que a industria faz, e ensinar a rede a RECONSTRUIR a operacao da maquina.
Quando chega uma leitura que ela nao consegue reconstruir, e porque aquela
combinacao de valores nunca aconteceu -> anomalia.

O que a rede aprende que um IF nao pega:
  - m1_vel e m1_acel tem correlacao 1.00 (aceleracao e funcao linear da velocidade)
  - m1 e m2 andam juntos (correlacao 1.00) - sao o mesmo conjunto mecanico
  - m1_temp e m2_temp correlacao 0.95
Se o eixo 1 vibrar 7 mm/s e o eixo 2 ficar parado, cada valor isolado passa em
qualquer limite fixo - mas a COMBINACAO e fisicamente impossivel nessa maquina.
Isso so uma rede que aprendeu a relacao entre as variaveis detecta.

Arquitetura 6 -> 8 -> 2 -> 8 -> 6 (tanh nas ocultas, sigmoide na saida).
Gargalo de 2 neuronios: obriga a rede a resumir 6 sensores em 2 numeros, ou seja,
a descobrir sozinha que so existem ~2 graus de liberdade reais (vibracao e temperatura).

Roda com numpy puro (sem TensorFlow/sklearn - nao instalados nesta maquina).
Saida: data/forzy-model.js  (pesos + normalizacao + limiares calibrados)

    python treinar_modelo.py
"""
import json
import os
import datetime
import numpy as np

RAIZ = os.path.dirname(os.path.abspath(__file__))
SEED = 42
rng = np.random.default_rng(SEED)
NL = '\n'


# ------------------------------------------------------------------ dados
def carregar():
    p = os.path.join(RAIZ, 'data', 'forzy-data.js')
    s = open(p, encoding='utf-8').read()
    s = s[s.index('{'):].rstrip().rstrip(';')
    d = json.loads(s)
    cols = d['meta']['cols']
    n = d['meta']['n']
    X = np.array([d['m1']['vel'], d['m1']['acel'], d['m1']['temp'],
                  d['m2']['vel'], d['m2']['acel'], d['m2']['temp']],
                 dtype=np.float64).T
    assert X.shape == (n, 6), X.shape
    return X, cols, d['meta']


# --------------------------------------------------------- normalizacao
# min-max robusto (p0.5 / p99.5) pra um outlier unico nao achatar a escala toda.
def escala(X):
    lo = np.percentile(X, 0.5, axis=0)
    hi = np.percentile(X, 99.5, axis=0)
    hi = np.where(hi - lo < 1e-9, lo + 1e-9, hi)
    return lo, hi


def norm(X, lo, hi):
    return np.clip((X - lo) / (hi - lo), 0.0, 1.0)


# ------------------------------------------------------------------ rede
DIMS = [6, 8, 2, 8, 6]


def init_pesos():
    Ws, bs = [], []
    for i in range(len(DIMS) - 1):
        fan_in, fan_out = DIMS[i], DIMS[i + 1]
        lim = np.sqrt(6.0 / (fan_in + fan_out))          # Xavier uniforme
        Ws.append(rng.uniform(-lim, lim, (fan_in, fan_out)))
        bs.append(np.zeros(fan_out))
    return Ws, bs


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -60, 60)))


def frente(X, Ws, bs):
    """Retorna (saida, caches) - tanh nas ocultas, sigmoide na ultima."""
    a = X
    cache = [a]
    n = len(Ws)
    for i in range(n):
        z = a @ Ws[i] + bs[i]
        a = sigmoid(z) if i == n - 1 else np.tanh(z)
        cache.append(a)
    return a, cache


def treinar(Xtr, Xva, epocas=600, lote=128, lr=3e-3):
    Ws, bs = init_pesos()
    mW = [np.zeros_like(w) for w in Ws]
    vW = [np.zeros_like(w) for w in Ws]
    mb = [np.zeros_like(b) for b in bs]
    vb = [np.zeros_like(b) for b in bs]
    b1, b2, eps = 0.9, 0.999, 1e-8
    t = 0
    hist = []
    n = len(Xtr)

    for ep in range(1, epocas + 1):
        ordem = rng.permutation(n)
        for ini in range(0, n, lote):
            xb = Xtr[ordem[ini:ini + lote]]
            saida, cache = frente(xb, Ws, bs)
            m = len(xb)

            # dL/dz da ultima camada (MSE + sigmoide)
            d = (2.0 / m) * (saida - xb) * saida * (1.0 - saida)
            gW = [None] * len(Ws)
            gb = [None] * len(bs)
            for i in range(len(Ws) - 1, -1, -1):
                gW[i] = cache[i].T @ d
                gb[i] = d.sum(axis=0)
                if i > 0:
                    d = (d @ Ws[i].T) * (1.0 - cache[i] ** 2)   # derivada do tanh

            t += 1
            for i in range(len(Ws)):
                mW[i] = b1 * mW[i] + (1 - b1) * gW[i]
                vW[i] = b2 * vW[i] + (1 - b2) * gW[i] ** 2
                mb[i] = b1 * mb[i] + (1 - b1) * gb[i]
                vb[i] = b2 * vb[i] + (1 - b2) * gb[i] ** 2
                Ws[i] -= lr * (mW[i] / (1 - b1 ** t)) / (np.sqrt(vW[i] / (1 - b2 ** t)) + eps)
                bs[i] -= lr * (mb[i] / (1 - b1 ** t)) / (np.sqrt(vb[i] / (1 - b2 ** t)) + eps)

        if ep % 50 == 0 or ep == 1:
            ltr = float(((frente(Xtr, Ws, bs)[0] - Xtr) ** 2).mean())
            lva = float(((frente(Xva, Ws, bs)[0] - Xva) ** 2).mean())
            hist.append((ep, ltr, lva))
            print('  epoca %4d  treino %.6f   validacao %.6f' % (ep, ltr, lva))
    return Ws, bs, hist


def erro_por_amostra(X, Ws, bs):
    rec, _ = frente(X, Ws, bs)
    return ((rec - X) ** 2).mean(axis=1), rec


def arr(a, casas=6):
    if a.ndim == 1:
        return '[' + ','.join('%.*f' % (casas, x) for x in a) + ']'
    return '[' + ','.join(arr(r, casas) for r in a) + ']'


# ------------------------------------------------------------------ main
def main():
    X, cols, meta = carregar()
    print('dataset: %d amostras x %d variaveis  (%s)' % (X.shape[0], X.shape[1], ', '.join(cols)))

    lo, hi = escala(X)
    Xn = norm(X, lo, hi)

    idx = rng.permutation(len(Xn))
    corte = int(len(Xn) * 0.8)
    Xtr, Xva = Xn[idx[:corte]], Xn[idx[corte:]]
    print('treino %d | validacao %d' % (len(Xtr), len(Xva)))

    print('treinando autoencoder %s ...' % '-'.join(map(str, DIMS)))
    Ws, bs, hist = treinar(Xtr, Xva)

    err, rec = erro_por_amostra(Xn, Ws, bs)

    # Limiares calibrados na propria distribuicao de erro do historico:
    #   p95   -> a partir daqui a leitura ja e incomum       (P2 / medio)
    #   p99.5 -> praticamente nunca aconteceu no historico   (P1 / critico)
    lim_p2 = float(np.percentile(err, 95.0))
    lim_p1 = float(np.percentile(err, 99.5))

    # Limiares de ALARME (pipeline da topbar) sao mais altos que os de ANALISE acima.
    # Motivo: por construcao 5% do historico fica acima do p95. No modo demo o dataset
    # roda frame a frame, entao usar o p95 pra alarmar geraria um alarme a cada ~20
    # quadros - ruido puro, o oposto do que a ISA-18.2 pede. Alarme so quando a leitura
    # e mais estranha que praticamente tudo que a maquina ja fez:
    #   p99.9 -> P2 (cerca de 7 pontos em 7183)
    #   maximo do historico -> P1 (nada do historico dispara; so o que e realmente novo)
    alarme_p2 = float(np.percentile(err, 99.9))
    alarme_p1 = float(err.max())

    # referencia por variavel pra atribuicao ("qual sensor esta fora")
    err_col = ((rec - Xn) ** 2).mean(axis=0)
    err_col = np.where(err_col < 1e-9, 1e-9, err_col)

    n_par = sum(w.size for w in Ws) + sum(b.size for b in bs)
    print('')
    print('parametros treinados: %d' % n_par)
    print('erro (MSE) medio %.6f | p95 %.6f | p99.5 %.6f' % (err.mean(), lim_p2, lim_p1))
    print('limiar de alarme: P2 %.6f (indice %.2f) | P1 %.6f (indice %.2f)'
          % (alarme_p2, alarme_p2 / lim_p2, alarme_p1, alarme_p1 / lim_p2))
    print('quadros do historico que alarmariam: P2 %d | P1 %d de %d'
          % (int((err >= alarme_p2).sum()), int((err >= alarme_p1).sum()), len(err)))

    # ---------------- validacao de sanidade: casos conhecidos ----------------
    def indice(v):
        e, _ = erro_por_amostra(norm(np.array([v], dtype=float), lo, hi), Ws, bs)
        return float(e[0]) / lim_p2

    rel = lim_p1 / lim_p2
    print('')
    print('--- sanidade (indice: <1 normal | 1 a %.2f medio | >%.2f critico) ---' % (rel, rel))
    casos = [
        ('maquina parada (normal no historico)',       [0.05, 0.00, 28.0, 0.05, 0.00, 35.0]),
        ('operacao pesada real (normal p/ a maquina)',  [7.46, 0.57, 28.0, 7.65, 0.59, 35.0]),
        ('eixo 1 a 7.0 com eixo 2 parado (impossivel)', [7.00, 0.50, 32.0, 0.05, 0.00, 36.0]),
        ('vibracao alta e aceleracao zero (sensor)',    [6.50, 0.00, 30.0, 6.60, 0.50, 36.0]),
        ('temperatura fora de escala (50 C)',           [3.00, 0.22, 50.0, 3.10, 0.23, 50.0]),
    ]
    for nome, v in casos:
        print('  %7.2f  %s' % (indice(v), nome))

    # ------------------------------- export -------------------------------
    stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    cabecalho = (
        '/* Auto-gerado por treinar_modelo.py em %s. Nao editar a mao.\n'
        '   Autoencoder %s treinado em %d amostras (validacao %d) do Dataset Forzy.\n'
        '   %d parametros. Inferencia em modelo.js. */\n'
    ) % (stamp, '-'.join(map(str, DIMS)), len(Xtr), len(Xva), n_par)

    corpo = [
        'window.FORZY_MODELO = {',
        "  versao: '1.0',",
        "  gerado: '%s'," % stamp,
        '  arquitetura: %s,' % json.dumps(DIMS),
        "  ativacoes: ['tanh','tanh','tanh','sigmoid'],",
        '  cols: %s,' % json.dumps(cols),
        '  treino: { amostras: %d, validacao: %d, epocas: 600, parametros: %d,'
        % (len(Xtr), len(Xva), n_par),
        '    mse_treino: %.6f, mse_validacao: %.6f },' % (hist[-1][1], hist[-1][2]),
        '  norm: { lo: %s, hi: %s },' % (arr(lo, 4), arr(hi, 4)),
        '  limiares: { p2: %.8f, p1: %.8f },' % (lim_p2, lim_p1),
        '  alarme: { p2: %.8f, p1: %.8f },' % (alarme_p2, alarme_p1),
        '  erroCol: %s,' % arr(err_col, 8),
        '  W: [',
        (',' + NL).join('    ' + arr(w) for w in Ws),
        '  ],',
        '  b: [',
        (',' + NL).join('    ' + arr(b) for b in bs),
        '  ]',
        '};',
        '',
    ]

    saida = os.path.join(RAIZ, 'data', 'forzy-model.js')
    open(saida, 'w', encoding='utf-8').write(cabecalho + NL.join(corpo))
    print('')
    print('escrito: %s  (%.1f KB)' % (saida, os.path.getsize(saida) / 1024.0))


if __name__ == '__main__':
    main()
