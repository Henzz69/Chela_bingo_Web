import os

patterns = [
    "bingo_balance", "bingo_users", "sports_transactions",
    "bingo_wallet_tx", "BingoUser", "BingoSession", "BingoWalletTx", "SportsTransaction"
]
dirs = [
    r"C:\Users\Henok\betting-site\frontend\app",
    r"C:\Users\Henok\betting-site\frontend\lib",
    r"C:\Users\Henok\betting-site\backend",
]
hits = []
for d in dirs:
    for root, _, fnames in os.walk(d):
        for fname in fnames:
            if fname.endswith((".ts", ".tsx", ".py")):
                fpath = os.path.join(root, fname)
                fc = open(fpath, encoding="utf-8", errors="ignore").read()
                for p in patterns:
                    if p in fc:
                        for i, line in enumerate(fc.splitlines(), 1):
                            if p in line:
                                hits.append(f"  [{p}] {fname}:{i}: {line.strip()[:100]}")

if hits:
    print("LEGACY IDENTIFIERS FOUND:")
    for h in hits:
        print(h)
else:
    print("CLEAN: 0 legacy identifiers in .ts/.tsx/.py files")
