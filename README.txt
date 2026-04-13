========================================
  BOT DISCORD XMAHUB — Guide d'installation
========================================

PRÉREQUIS
----------
- Node.js v18 ou supérieur
- npm installé

INSTALLATION
------------
1. Dépose tous ces fichiers sur ton hébergeur
2. Dans le terminal, installe les dépendances :

   npm install

3. Le fichier .env est déjà pré-rempli avec tes identifiants.
   Si tu changes de token, modifie la ligne DISCORD_TOKEN= dans .env

LANCEMENT
----------
   node src/index.js

Pour garder le bot actif en permanence avec PM2 :

   npm install -g pm2
   pm2 start src/index.js --name discord-bot
   pm2 save
   pm2 startup

========================================
COMMANDES DU BOT
========================================

!embedrôle         → Envoie le panneau de sélection de rôle (admin uniquement)
!panneauticket     → Envoie le panneau de création de tickets (admin uniquement)

========================================
FONCTIONNALITÉS TICKETS
========================================

- Bouton "Ouvrir un ticket"  → Crée un salon privé dans la catégorie tickets ouverts
- Bouton "Fermer le ticket"  → Déplace le salon dans la catégorie tickets fermés
- Bouton "Réouvrir"          → Remet le salon dans la catégorie tickets ouverts
- Bouton "Supprimer"         → Supprime le salon (admin uniquement, délai 5s)
- Logs automatiques dans le salon de logs configuré

========================================
PERMISSIONS DISCORD REQUISES
========================================

Le bot doit avoir :
- Gérer les salons
- Gérer les rôles
- Voir les salons
- Envoyer des messages
- Lire l'historique des messages

Le rôle du bot doit être PLUS HAUT dans la hiérarchie 
que les rôles Homme, Femme dans les paramètres du serveur.
