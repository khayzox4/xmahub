==============================
  BOT DISCORD - ROLE GENRE
==============================

PRÉREQUIS
----------
- Node.js v18 ou supérieur installé
- npm ou pnpm installé

INSTALLATION
------------
1. Décompresse ce dossier sur ton hébergeur
2. Ouvre un terminal dans le dossier et installe les dépendances :

   npm install
   (ou : pnpm install)

3. Crée un fichier .env en copiant .env.example :

   cp .env.example .env

4. Modifie le fichier .env avec ton vrai token :

   DISCORD_TOKEN=MTMxMzk4OTMxOTMyODkyNzgwNQ.GPWqIW.u7dumcJX9FIHHm7J1o5ytUdoO033w5mwUj05IQ
   DISCORD_ROLE_HOMME=1481731307896700979
   DISCORD_ROLE_FEMME=1481731308659937371

LANCEMENT
----------
   node src/index.js

Pour garder le bot actif en permanence, utilise PM2 :

   npm install -g pm2
   pm2 start src/index.js --name discord-bot
   pm2 save
   pm2 startup

UTILISATION DU BOT
-------------------
- Commande : !embedrôle (ou !embedrole)
- Réservée aux membres avec la permission Administrateur
- Le bot envoie un embed avec deux boutons : Homme / Femme
- Chaque membre peut cliquer pour obtenir/changer son rôle

IMPORTANT
----------
Assure-toi que le rôle du bot est PLUS HAUT dans la hiérarchie 
des rôles Discord que les rôles Homme et Femme, sinon le bot 
ne pourra pas les attribuer.

Le bot doit avoir la permission "Gérer les rôles" sur le serveur.
