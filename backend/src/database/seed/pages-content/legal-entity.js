/** The legal entity behind THROTTLEIN, quoted by every policy and seller document. */
const ENTITY = 'Noseberry Private Limited';
const ADDRESS =
  'TS-1201, 12th Floor, Galaxy Blue Sapphire Plaza, Plot No. C-03, Sector-4, Greater Noida West, Uttar Pradesh – 201309, India';
const GSTIN = '09AAGCN8874N1ZG';
const CONTACT = 'info@throttlein.com';
const JURISDICTION = 'Gautam Budh Nagar (Greater Noida), Uttar Pradesh, India';

const ENTITY_BLOCK = `THROTTLEIN is operated by **${ENTITY}**, ${ADDRESS}. GSTIN: ${GSTIN}.`;

module.exports = { ENTITY, ADDRESS, GSTIN, CONTACT, JURISDICTION, ENTITY_BLOCK };
