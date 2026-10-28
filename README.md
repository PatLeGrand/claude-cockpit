# Cockpit pour Claude Code

Un mod Claude Code qui affiche l'état de ta session sans quitter la conversation : remplissage du contexte, coût, limites d'usage, fichiers modifiés, activité des outils et suivi des sous-agents.

## Ce qu'il ajoute

**Une jauge fine au-dessus du prompt**

```
▰▰▰▱▱▱▱▱ 42% · 84k · 0,83$ · ◐ 2 agents  ◂
```

- La barre passe du vert à l'orange (50 %) puis au rouge (80 %).
- Un chrono s'affiche pendant que Claude travaille.
- Un lien « compacter » apparaît à partir de 70 % de contexte.
- La flèche ◂ / ▸ ouvre ou ferme le panneau Cockpit.

**Un panneau Cockpit à côté du chat**

- Contexte, coût, limites 5 h et 7 jours, durée du dernier tour.
- Les agents en cours et terminés, avec leur durée et leur action du moment.
- Les fichiers modifiés pendant la session.
- L'activité récente des outils (✓ réussi, ✗ erreur, ⊘ bloqué).

**Suivi des sous-agents**

- Les sous-agents Claude (outil Agent), y compris ceux lancés en arrière-plan.
- Les agents externes lancés par le terminal : `sol`, `luna`, `gemini`, `codex`, `agy`, directement, via un script `scripts/<nom>.sh` ou via `delegate.mjs <nom>`.
- Les outils MCP qui portent l'un de ces noms.
- Un message à la fin de chaque agent, et une notification système s'il a duré plus d'une minute.

**Autres petits plus**

- L'outil en cours dans la barre d'état, avec le nom de l'agent qui l'utilise.
- Une alerte quand le contexte dépasse 80 %.
- Commandes `/cockpit` (ouvre le panneau) et `/jauge` (affiche ou masque la jauge).

## Installation

Dans une session Claude Code au terminal :

```
/plugin install cockpit --marketplace PatLeGrand/claude-cockpit
```

Réponds `y` pour ajouter le catalogue, puis choisis la portée de l'installation.

Depuis un shell :

```bash
claude plugin install cockpit --marketplace PatLeGrand/claude-cockpit
```

## Désactiver ou désinstaller

```bash
claude plugin disable cockpit
```

```bash
claude plugin uninstall cockpit
```

## Développement

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## Licence

MIT
