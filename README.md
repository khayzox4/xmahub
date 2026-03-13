# 🎉 Giveaway Bot Discord

Bot Discord pour gérer des giveaways avec des embeds stylisés et sélection automatique des gagnants.

## Fonctionnalités

- `/creategiveaway prix duree gagnants [conditions]` — Lance un giveaway avec un embed Discord
- `/listgiveaways` — Affiche tous les giveaways actifs
- `/endgiveaway id` — Termine un giveaway manuellement
- Les participants rejoignent en réagissant avec 🎉
- Les gagnants sont sélectionnés automatiquement à la fin de la durée
- L'embed est mis à jour quand le giveaway se termine

## Installation

### Prérequis

- Node.js 18+
- Une base de données PostgreSQL
- Un bot Discord (Discord Developer Portal)

### Étapes

**1. Cloner et installer les dépendances**
```bash
npm install
```

**2. Configurer les variables d'environnement**
```bash
cp .env.example .env
# Éditez .env avec vos valeurs
```

**3. Créer les tables en base de données**
```bash
npm run migrate
```

**4. Démarrer le bot**
```bash
npm start
```

## Configuration du bot Discord

1. Allez sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Créez une nouvelle application
3. Allez dans **Bot** → cliquez **Reset Token** → copiez le token → mettez-le dans `DISCORD_TOKEN`
4. Copiez l'**Application ID** → mettez-le dans `DISCORD_CLIENT_ID`
5. Dans **Bot** → activez ces **Privileged Gateway Intents** :
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
6. Dans **OAuth2 > URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Permissions : `Send Messages`, `Add Reactions`, `Read Message History`, `Use Slash Commands`
7. Copiez l'URL générée et invitez le bot sur votre serveur

## Hébergeurs recommandés

| Hébergeur | Prix | Notes |
|-----------|------|-------|
| [Railway](https://railway.app) | Gratuit / Payant | Très simple, inclut PostgreSQL |
| [Render](https://render.com) | Gratuit / Payant | Worker gratuit + PostgreSQL |
| [Fly.io](https://fly.io) | Gratuit | Nécessite un compte |
| [Heroku](https://heroku.com) | Payant | Classique |

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Token du bot Discord |
| `DISCORD_CLIENT_ID` | ID de l'application Discord |
| `DATABASE_URL` | URL de connexion PostgreSQL |

## Commandes

| Commande | Description |
|----------|-------------|
| `/creategiveaway` | Lance un giveaway |
| `/listgiveaways` | Liste les giveaways actifs |
| `/endgiveaway` | Termine un giveaway manuellement |
