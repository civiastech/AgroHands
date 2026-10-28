// French course text. Same shape as the English source in courses.js: same lessons, same paragraphs,
// same quiz questions and the SAME OPTION ORDER (grading uses the option index). test/unit.test.js checks this.
// Safety-critical content: have a native French speaker with agricultural-safety knowledge review before launch.
export default {
  'safety-101': {
    title: 'Sécurité à la ferme, EPI et premiers secours',
    lessons: [
      {
        title: 'Connaître les dangers d’une ferme',
        body: [
          'La plupart des blessures à la ferme viennent des outils (machette, houe), des machines (tracteur, pompes), des produits chimiques, des animaux, de la chaleur et des serpents.',
          'Chaque jour, avant le travail, observez votre zone de travail. Signalez à votre chef les trous, les outils cassés, les fils électriques mal fixés ou les nids de guêpes.',
          'Ne travaillez jamais seul loin des autres. Dites à quelqu’un où vous allez.',
        ],
      },
      {
        title: 'Équipements de protection individuelle (EPI)',
        body: [
          'Les bottes protègent vos pieds des coupures, des épines et des morsures de serpent. Les gants protègent vos mains des coupures et des produits chimiques.',
          'Pour pulvériser, il vous faut : manches longues, pantalon, bottes, gants, masque et protection des yeux. Pas d’EPI = pas de pulvérisation.',
          'Votre employeur doit fournir les EPI nécessaires au travail. S’ils manquent, demandez-les avant de commencer. C’est votre droit.',
        ],
      },
      {
        title: 'Chaleur, eau et repos',
        body: [
          'Buvez souvent de l’eau propre, même avant d’avoir soif. Reposez-vous à l’ombre si vous avez des vertiges, si vous vous sentez faible ou si vous avez mal à la tête.',
          'Un coup de chaleur peut tuer. Si un collègue devient confus ou ne transpire plus, mettez-le à l’ombre, rafraîchissez-le avec de l’eau et appelez à l’aide.',
        ],
      },
      {
        title: 'Premiers secours simples',
        body: [
          'Coupures : appuyez un tissu propre sur la plaie pour arrêter le saignement, puis lavez à l’eau propre et couvrez.',
          'Morsure de serpent : gardez la personne calme et immobile, retirez bagues et objets serrés, et emmenez-la vite à l’hôpital. N’incisez pas la plaie et n’aspirez pas le venin.',
          'Produit chimique sur la peau ou dans les yeux : rincez abondamment à l’eau propre pendant au moins 15 minutes, puis consultez un médecin. Emportez l’étiquette du produit.',
        ],
      },
    ],
    quiz: [
      { q: 'On vous demande de pulvériser mais il n’y a ni gants ni masque. Que faites-vous ?', options: ['Je pulvérise quand même, vite', 'Je demande les EPI avant de commencer', 'Je me couvre le visage avec ma chemise'] },
      { q: 'Un serpent mord un collègue. Quelle est la bonne réaction ?', options: ['Inciser la plaie et aspirer le venin', 'Le garder immobile et l’emmener vite à l’hôpital', 'Lui donner du vin de palme'] },
      { q: 'Un produit chimique vous éclabousse l’œil. Que faites-vous d’abord ?', options: ['Je frotte l’œil', 'Je rince à l’eau propre pendant 15 minutes', 'J’attends de voir'] },
      { q: 'Quand faut-il boire de l’eau par forte chaleur ?', options: ['Seulement au déjeuner', 'Souvent, même avant d’avoir soif', 'Seulement quand j’ai des vertiges'] },
    ],
  },

  'rights-101': {
    title: 'Votre contrat, vos droits, votre conduite',
    lessons: [
      {
        title: 'Votre contrat',
        body: [
          'Chaque emploi AgroHands a un contrat écrit. Il indique la ferme, le travail, votre salaire, la fréquence de paie, vos horaires et le préavis.',
          'Le contrat vous est lu dans votre langue avant la signature. Ne signez rien que vous ne comprenez pas. Demandez à un agent AgroHands.',
        ],
      },
      {
        title: 'Votre salaire',
        body: [
          'Votre salaire doit être payé en argent (pas seulement en nourriture ou en biens), en totalité, le jour convenu.',
          'AgroHands ne vous fait jamais payer pour trouver un emploi. Si quelqu’un vous demande de payer pour obtenir un emploi via AgroHands, signalez-le.',
          'Personne n’a le droit de garder votre carte d’identité ou votre téléphone pour vous forcer à rester. Vous pouvez partir en respectant le préavis de votre contrat.',
        ],
      },
      {
        title: 'Une bonne conduite améliore votre note',
        body: [
          'Arrivez à l’heure, faites le travail convenu, prenez soin des outils et respectez les biens de la ferme. Prévenez votre chef tôt si vous ne pouvez pas venir.',
          'De bonnes notes vous font monter au niveau Argent puis Or, où les emplois paient mieux. Partir sans préavis fait baisser votre score de fiabilité.',
        ],
      },
      {
        title: 'Quand quelque chose ne va pas',
        body: [
          'Si vous n’êtes pas payé, si vous êtes maltraité ou si l’on vous demande un travail dangereux sans EPI, ouvrez un litige dans l’application ou prévenez votre agent.',
          'AgroHands prend l’affaire en main, parle aux deux parties et aide à trouver une solution. Les cas graves peuvent être portés au bureau du ministère du Travail.',
        ],
      },
    ],
    quiz: [
      { q: 'Quelqu’un dit que vous devez payer 5 000 ₦ pour obtenir un emploi AgroHands. Qu’est-ce qui est vrai ?', options: ['Je dois payer', 'AgroHands ne fait jamais payer les ouvriers — je le signale', 'Je paie la moitié'] },
      { q: 'Un employeur peut-il garder votre carte d’identité pour vous empêcher de partir ?', options: ['Oui', 'Non'] },
      { q: 'Vous ne pouvez pas venir travailler demain. Que devez-vous faire ?', options: ['Rester simplement à la maison', 'Prévenir mon chef tôt', 'Envoyer quelqu’un d’autre sans demander'] },
      { q: 'Qu’est-ce qui vous fait monter au niveau Argent et Or ?', options: ['De bonnes notes, la vérification et la formation', 'Payer des frais', 'Avoir beaucoup de téléphones'] },
    ],
  },

  'agrochem-201': {
    title: 'Manipuler les produits agrochimiques en sécurité',
    lessons: [
      {
        title: 'Lisez l’étiquette (ou demandez)',
        body: [
          'Chaque étiquette indique : à quoi sert le produit, la dose à mélanger, les EPI à porter et le délai avant de pouvoir entrer dans le champ ou récolter.',
          'La bande de couleur indique le danger : rouge = très dangereux, jaune = dangereux, bleu = nocif, vert = moins nocif. Si vous ne savez pas lire l’étiquette, demandez à votre chef de vous la lire.',
        ],
      },
      {
        title: 'Mélange et pulvérisation',
        body: [
          'Mélangez en plein air, loin des puits, des cours d’eau et des enfants. Respectez la dose de l’étiquette — plus de produit n’est pas plus efficace, cela vous nuit, à vous et à la culture.',
          'Ne pulvérisez pas par vent fort, sous la pluie ni aux heures les plus chaudes. Marchez de façon à ce que le vent emporte le produit loin de vous.',
          'Ne mangez, ne buvez et ne fumez jamais pendant la pulvérisation. Lavez-vous les mains et le visage avant de manger.',
        ],
      },
      {
        title: 'Après la pulvérisation',
        body: [
          'Lavez le pulvérisateur loin des points d’eau. Lavez vos EPI et vos vêtements séparément de ceux de la famille. Lavez-vous au savon.',
          'N’utilisez jamais un bidon de produit chimique vide pour transporter de l’eau ou de la nourriture. Rapportez-le ou détruisez-le selon les consignes.',
          'Signalez les champs traités pour que personne n’y entre avant le délai de sécurité indiqué sur l’étiquette.',
        ],
      },
    ],
    quiz: [
      { q: 'L’étiquette a une bande rouge. Qu’est-ce que cela signifie ?', options: ['Très dangereux', 'Sans danger pour les enfants', 'Engrais'] },
      { q: 'Peut-on utiliser un bidon de produit chimique vide pour garder de l’eau potable ?', options: ['Oui, s’il est lavé', 'Jamais'] },
      { q: 'Quand est-ce un mauvais moment pour pulvériser ?', options: ['Tôt le matin, sans vent', 'Par vent fort ou sous la pluie'] },
      { q: 'Vous voulez un produit plus efficace. Que faites-vous ?', options: ['Je double la dose', 'Je respecte la dose de l’étiquette'] },
    ],
  },

  'gap-201': {
    title: 'Bonnes pratiques agricoles : hygiène et registres',
    lessons: [
      {
        title: 'Pourquoi les acheteurs y tiennent',
        body: [
          'Les supermarchés, les exportateurs et les transformateurs achètent aux fermes qui produisent des aliments sains et tiennent des registres. Les ouvriers qui connaissent les BPA valent plus.',
        ],
      },
      {
        title: 'Hygiène à la récolte',
        body: [
          'Lavez-vous les mains au savon avant la récolte, après être allé aux toilettes et après avoir mangé. Ne récoltez pas si vous avez la diarrhée ou des plaies ouvertes aux mains — prévenez votre chef.',
          'Utilisez des caisses propres. Ne posez jamais la récolte directement sur le sol. Tenez les animaux à l’écart des zones de récolte.',
        ],
      },
      {
        title: 'Les registres',
        body: [
          'Notez ce qui a été fait, où et quand : plantation, pulvérisation (produit, dose, parcelle), engrais et récolte. Les registres permettent aux acheteurs de retrouver le champ d’origine de chaque caisse.',
        ],
      },
    ],
    quiz: [
      { q: 'Où faut-il mettre la récolte ?', options: ['Sur le sol', 'Dans des caisses propres'] },
      { q: 'Vous avez la diarrhée le jour de la récolte. Que faites-vous ?', options: ['Je récolte quand même', 'Je préviens mon chef et je ne touche pas aux produits'] },
      { q: 'Pourquoi tenir un registre des pulvérisations ?', options: ['Les acheteurs peuvent retrouver le champ d’origine', 'Cela ne sert à rien'] },
    ],
  },

  'employer-101': {
    title: 'Emploi équitable : contrats, salaires et fidélisation des bons ouvriers',
    lessons: [
      {
        title: 'Contrats et mentions écrites',
        body: [
          'Le Labour Act exige des mentions écrites de l’emploi dans les trois mois : les parties, la nature du travail, le salaire et la périodicité de paie, les horaires, les congés et le préavis. AgroHands les génère dès le premier jour pour chaque embauche.',
          'Selon le Labour Act, le préavis dépend de l’ancienneté : un jour (jusqu’à 3 mois), une semaine (de 3 mois à 2 ans), deux semaines (de 2 à 5 ans), un mois (5 ans et plus), sauf si le contrat prévoit davantage.',
        ],
      },
      {
        title: 'Salaires et retenues',
        body: [
          'Payez les salaires en argent, en totalité, le jour convenu. Le Labour Act interdit les retenues sur salaire sauf celles que la loi autorise. Ne retenez rien pour les outils, la nourriture ou des « amendes ».',
          'Les ouvriers payés à temps restent plus longtemps. Sur AgroHands, payer à temps améliore la note de votre ferme, ce qui attire de meilleurs ouvriers.',
        ],
      },
      {
        title: 'La sécurité est le devoir de l’employeur',
        body: [
          'Fournissez les EPI adaptés au travail confié, surtout pour la pulvérisation et les machines. Ayez une trousse de premiers secours et un moyen de rejoindre un centre de santé.',
          'N’employez personne de moins de 18 ans pour des travaux agricoles dangereux. AgroHands exclut les moins de 18 ans des offres d’emploi.',
        ],
      },
      {
        title: 'Garder les bons ouvriers',
        body: [
          'Des tâches claires, un encadrement respectueux, un logement décent quand il est fourni, de l’eau propre et des pauses réduisent les absences et les départs.',
          'Notez les ouvriers honnêtement après 30 jours et à la fin du contrat. Les notes décident qui vous voyez en premier la fois suivante.',
        ],
      },
    ],
    quiz: [
      { q: 'Pouvez-vous retenir 2 000 ₦ sur le salaire d’un ouvrier pour une houe cassée ?', options: ['Oui, à tout moment', 'Non — les retenues ne sont permises que si la loi l’autorise'] },
      { q: 'Qui fournit les EPI pour la pulvérisation ?', options: ['L’employeur', 'L’ouvrier doit les acheter'] },
      { q: 'Un ouvrier a 1 an d’ancienneté. Quel est le préavis minimum selon le Labour Act ?', options: ['Un jour', 'Une semaine', 'Un mois'] },
    ],
  },
};
