'use strict';
/**
 * "What is what" — classification of OSM features into human-readable kinds (English + Danish),
 * icons, groups and rendering hints. Shared by the city-pack converter (main process) and the UI.
 *
 * Every classification carries a confidence:
 *   'tagged'   – stated explicitly by an OSM tag on the object itself
 *   'name'     – inferred from the object's name (e.g. "Vor Frue Kirke" → church)
 *   'context'  – inferred from the surrounding area (e.g. building inside the university campus)
 *   'unknown'  – OSM only says "building=yes" and nothing else is known
 */

// ------------------------------------------------------------------ building kinds
// value: [English, Dansk, icon, group, facadeStyle, defaultLevels, defaultRoof]
// facadeStyle drives the procedural facade shader: brick | plaster | glass | concrete | metal | historic | house | retail | plain
const B = {
  apartments: ['Apartments', 'Etageboliger', '🏢', 'residential', 'brick', 4, 'auto'],
  residential: ['Residential building', 'Beboelsesbygning', '🏘️', 'residential', 'brick', 3, 'auto'],
  house: ['House', 'Hus', '🏠', 'residential', 'house', 1.5, 'gabled'],
  detached: ['Detached house', 'Parcelhus', '🏠', 'residential', 'house', 1.5, 'gabled'],
  semidetached_house: ['Semi-detached house', 'Dobbelthus', '🏠', 'residential', 'house', 2, 'gabled'],
  terrace: ['Terraced houses', 'Rækkehuse', '🏘️', 'residential', 'house', 2, 'gabled'],
  bungalow: ['Bungalow', 'Bungalow', '🏠', 'residential', 'house', 1, 'gabled'],
  villa: ['Villa', 'Villa', '🏡', 'residential', 'house', 2, 'hipped'],
  cabin: ['Cabin', 'Hytte', '🛖', 'residential', 'house', 1, 'gabled'],
  dormitory: ['Student housing (dormitory)', 'Kollegium', '🛏️', 'residential', 'brick', 4, 'auto'],
  farm: ['Farmhouse', 'Stuehus (landbrug)', '🏡', 'agricultural', 'house', 1.5, 'gabled'],
  houseboat: ['Houseboat', 'Husbåd', '🛥️', 'residential', 'plain', 1, 'flat'],
  static_caravan: ['Static caravan', 'Campingvogn (opstillet)', '🚐', 'residential', 'plain', 1, 'flat'],
  annexe: ['Annex', 'Anneks', '🏠', 'residential', 'house', 1, 'gabled'],
  allotment_house: ['Allotment cabin', 'Kolonihavehus', '🏡', 'residential', 'house', 1, 'gabled'],
  presbytery: ['Presbytery', 'Præstebolig', '⛪', 'residential', 'house', 2, 'gabled'],
  hotel: ['Hotel', 'Hotel', '🏨', 'commercial', 'plaster', 5, 'flat'],
  commercial: ['Commercial building', 'Erhvervsbygning', '🏬', 'commercial', 'concrete', 3, 'flat'],
  office: ['Office building', 'Kontorbygning', '🏢', 'commercial', 'glass', 4, 'flat'],
  retail: ['Retail building', 'Butiksbygning', '🛍️', 'commercial', 'retail', 2, 'flat'],
  supermarket: ['Supermarket', 'Supermarked', '🛒', 'commercial', 'retail', 1, 'flat'],
  kiosk: ['Kiosk', 'Kiosk', '🏪', 'commercial', 'retail', 1, 'flat'],
  industrial: ['Industrial building', 'Industribygning', '🏭', 'industrial', 'metal', 2, 'flat'],
  warehouse: ['Warehouse', 'Lagerbygning', '📦', 'industrial', 'metal', 2, 'flat'],
  factory: ['Factory', 'Fabrik', '🏭', 'industrial', 'metal', 2, 'flat'],
  manufacture: ['Manufacturing building', 'Produktionsbygning', '🏭', 'industrial', 'metal', 2, 'flat'],
  storage_tank: ['Storage tank', 'Tank', '🛢️', 'industrial', 'plain', 3, 'flat'],
  silo: ['Silo', 'Silo', '🛢️', 'industrial', 'plain', 6, 'flat'],
  digester: ['Digester', 'Rådnetank', '⚗️', 'industrial', 'plain', 3, 'dome'],
  service: ['Service / technical building', 'Teknikbygning', '🔧', 'utility', 'plain', 1, 'flat'],
  transformer_tower: ['Transformer tower', 'Transformertårn', '⚡', 'utility', 'brick', 3, 'pyramidal'],
  water_tower: ['Water tower', 'Vandtårn', '🗼', 'utility', 'brick', 8, 'flat'],
  civic: ['Civic building', 'Offentlig bygning', '🏛️', 'civic', 'plaster', 3, 'flat'],
  public: ['Public building', 'Offentlig bygning', '🏛️', 'civic', 'plaster', 3, 'flat'],
  government: ['Government building', 'Statslig bygning', '🏛️', 'civic', 'plaster', 3, 'flat'],
  townhall: ['Town hall', 'Rådhus', '🏛️', 'civic', 'historic', 4, 'flat'],
  fire_station: ['Fire station', 'Brandstation', '🚒', 'civic', 'brick', 2, 'flat'],
  military: ['Military building', 'Militær bygning', '🪖', 'civic', 'brick', 2, 'gabled'],
  school: ['School', 'Skole', '🏫', 'education', 'brick', 2, 'flat'],
  university: ['University building', 'Universitetsbygning', '🎓', 'education', 'brick', 4, 'flat'],
  college: ['College / further education', 'Uddannelsesinstitution', '🎓', 'education', 'brick', 3, 'flat'],
  kindergarten: ['Kindergarten / day care', 'Børnehave / daginstitution', '🧸', 'education', 'house', 1, 'gabled'],
  library: ['Library', 'Bibliotek', '📚', 'education', 'glass', 3, 'flat'],
  museum: ['Museum', 'Museum', '🏛️', 'culture', 'plaster', 3, 'flat'],
  hospital: ['Hospital', 'Hospital / sygehus', '🏥', 'health', 'concrete', 5, 'flat'],
  clinic: ['Clinic', 'Klinik', '⚕️', 'health', 'plaster', 2, 'flat'],
  church: ['Church', 'Kirke', '⛪', 'religious', 'historic', 2, 'gabled'],
  cathedral: ['Cathedral', 'Domkirke', '⛪', 'religious', 'historic', 4, 'gabled'],
  chapel: ['Chapel', 'Kapel', '⛪', 'religious', 'historic', 1, 'gabled'],
  monastery: ['Monastery', 'Kloster', '⛪', 'religious', 'historic', 2, 'gabled'],
  mosque: ['Mosque', 'Moské', '🕌', 'religious', 'plaster', 2, 'dome'],
  synagogue: ['Synagogue', 'Synagoge', '🕍', 'religious', 'brick', 2, 'flat'],
  temple: ['Temple', 'Tempel', '🛕', 'religious', 'plaster', 2, 'pyramidal'],
  religious: ['Religious building', 'Religiøs bygning', '🛐', 'religious', 'brick', 2, 'gabled'],
  shrine: ['Shrine', 'Helligdom', '⛩️', 'religious', 'plain', 1, 'pyramidal'],
  bell_tower: ['Bell tower', 'Klokketårn', '🔔', 'religious', 'historic', 5, 'pyramidal'],
  train_station: ['Train station', 'Togstation / banegård', '🚉', 'transport', 'historic', 2, 'flat'],
  transportation: ['Transport building', 'Trafikbygning', '🚏', 'transport', 'glass', 1, 'flat'],
  parking: ['Parking garage', 'Parkeringshus', '🅿️', 'transport', 'concrete', 4, 'flat'],
  hangar: ['Hangar', 'Hangar', '✈️', 'transport', 'metal', 2, 'round'],
  bridge: ['Bridge structure', 'Bro (bygværk)', '🌉', 'transport', 'concrete', 1, 'flat'],
  garage: ['Garage', 'Garage', '🚗', 'minor', 'plain', 1, 'flat'],
  garages: ['Garages', 'Garageanlæg', '🚗', 'minor', 'plain', 1, 'flat'],
  carport: ['Carport', 'Carport', '🚗', 'minor', 'plain', 1, 'flat'],
  shed: ['Shed', 'Skur', '🛖', 'minor', 'plain', 1, 'gabled'],
  hut: ['Hut', 'Hytte', '🛖', 'minor', 'plain', 1, 'gabled'],
  outbuilding: ['Outbuilding', 'Udhus', '🛖', 'minor', 'plain', 1, 'gabled'],
  container: ['Container', 'Container', '📦', 'minor', 'plain', 1, 'flat'],
  roof: ['Roof (open structure)', 'Overdækning', '⛱️', 'minor', 'plain', 1, 'flat'],
  toilets: ['Public toilets', 'Offentligt toilet', '🚻', 'minor', 'plain', 1, 'flat'],
  greenhouse: ['Greenhouse', 'Drivhus', '🌱', 'agricultural', 'glass', 1, 'gabled'],
  conservatory: ['Conservatory', 'Udestue', '🌿', 'residential', 'glass', 1, 'gabled'],
  barn: ['Barn', 'Lade', '🌾', 'agricultural', 'plain', 2, 'gabled'],
  stable: ['Stable', 'Stald', '🐎', 'agricultural', 'plain', 1, 'gabled'],
  cowshed: ['Cowshed', 'Kostald', '🐄', 'agricultural', 'plain', 1, 'gabled'],
  sty: ['Pigsty', 'Svinestald', '🐖', 'agricultural', 'plain', 1, 'gabled'],
  farm_auxiliary: ['Farm building', 'Landbrugsbygning', '🚜', 'agricultural', 'plain', 1, 'gabled'],
  grandstand: ['Grandstand', 'Tribune', '🏟️', 'sports', 'concrete', 2, 'skillion'],
  stadium: ['Stadium', 'Stadion', '🏟️', 'sports', 'concrete', 4, 'flat'],
  sports_hall: ['Sports hall', 'Idrætshal', '🏀', 'sports', 'metal', 2, 'flat'],
  sports_centre: ['Sports centre', 'Idrætscenter', '🏋️', 'sports', 'metal', 2, 'flat'],
  riding_hall: ['Riding hall', 'Ridehal', '🐎', 'sports', 'plain', 2, 'gabled'],
  pavilion: ['Pavilion', 'Pavillon', '⛱️', 'sports', 'plaster', 1, 'hipped'],
  boathouse: ['Boathouse', 'Bådehus', '🛶', 'sports', 'plain', 1, 'gabled'],
  bunker: ['Bunker', 'Bunker', '🪖', 'other', 'plain', 1, 'flat'],
  ruins: ['Ruins', 'Ruin', '🏚️', 'other', 'historic', 1, 'flat'],
  construction: ['Building under construction', 'Byggeri under opførelse', '🏗️', 'other', 'concrete', 2, 'flat'],
  tower: ['Tower', 'Tårn', '🗼', 'other', 'concrete', 6, 'flat'],
  gatehouse: ['Gatehouse', 'Porthus', '🚪', 'other', 'historic', 2, 'gabled'],
  castle: ['Castle', 'Slot', '🏰', 'other', 'historic', 3, 'gabled'],
  palace: ['Palace', 'Palæ', '🏰', 'other', 'historic', 3, 'hipped'],
  yes: ['Building', 'Bygning', '🏠', 'unknown', 'brick', 2, 'auto']
};

// ------------------------------------------------------------------ points of interest
// 'key=value': [English, Dansk, icon, group]
const P = {
  // food & drink
  'amenity=restaurant': ['Restaurant', 'Restaurant', '🍽️', 'food'], 'amenity=cafe': ['Café', 'Café', '☕', 'food'],
  'amenity=fast_food': ['Fast food', 'Fastfood', '🍔', 'food'], 'amenity=bar': ['Bar', 'Bar', '🍸', 'food'],
  'amenity=pub': ['Pub', 'Værtshus / pub', '🍺', 'food'], 'amenity=biergarten': ['Beer garden', 'Ølhave', '🍺', 'food'],
  'amenity=ice_cream': ['Ice cream', 'Isbutik', '🍦', 'food'], 'amenity=food_court': ['Food court', 'Madmarked', '🍱', 'food'],
  'amenity=nightclub': ['Nightclub', 'Natklub', '🪩', 'food'],
  // education
  'amenity=university': ['University', 'Universitet', '🎓', 'education'], 'amenity=college': ['College', 'Uddannelsesinstitution', '🎓', 'education'],
  'amenity=school': ['School', 'Skole', '🏫', 'education'], 'amenity=kindergarten': ['Kindergarten', 'Børnehave', '🧸', 'education'],
  'amenity=childcare': ['Childcare', 'Børnepasning', '🧸', 'education'], 'amenity=library': ['Library', 'Bibliotek', '📚', 'education'],
  'amenity=language_school': ['Language school', 'Sprogskole', '🗣️', 'education'], 'amenity=music_school': ['Music school', 'Musikskole', '🎼', 'education'],
  'amenity=driving_school': ['Driving school', 'Køreskole', '🚗', 'education'], 'amenity=research_institute': ['Research institute', 'Forskningsinstitut', '🔬', 'education'],
  'amenity=training': ['Training centre', 'Kursuscenter', '🧑‍🏫', 'education'], 'amenity=prep_school': ['Tutoring', 'Lektiehjælp', '📖', 'education'],
  // health
  'amenity=hospital': ['Hospital', 'Hospital', '🏥', 'health'], 'amenity=clinic': ['Clinic', 'Klinik', '⚕️', 'health'],
  'amenity=doctors': ['Doctor', 'Læge', '🩺', 'health'], 'amenity=dentist': ['Dentist', 'Tandlæge', '🦷', 'health'],
  'amenity=pharmacy': ['Pharmacy', 'Apotek', '💊', 'health'], 'amenity=veterinary': ['Veterinarian', 'Dyrlæge', '🐾', 'health'],
  'amenity=nursing_home': ['Nursing home', 'Plejehjem', '🧓', 'health'], 'amenity=social_facility': ['Social facility', 'Social institution', '🤝', 'health'],
  'healthcare=physiotherapist': ['Physiotherapist', 'Fysioterapeut', '💪', 'health'], 'healthcare=psychotherapist': ['Psychotherapist', 'Psykoterapeut', '🧠', 'health'],
  'healthcare=laboratory': ['Medical laboratory', 'Laboratorium', '🧪', 'health'], 'healthcare=optometrist': ['Optometrist', 'Optiker (syn)', '👓', 'health'],
  'healthcare=rehabilitation': ['Rehabilitation', 'Genoptræning', '🦽', 'health'], 'healthcare=blood_donation': ['Blood donation', 'Bloddonation', '🩸', 'health'],
  'healthcare=alternative': ['Alternative medicine', 'Alternativ behandling', '🌿', 'health'], 'healthcare=audiologist': ['Audiologist', 'Hørespecialist', '👂', 'health'],
  'healthcare=podiatrist': ['Podiatrist', 'Fodterapeut', '🦶', 'health'], 'healthcare=midwife': ['Midwife', 'Jordemoder', '🤱', 'health'],
  'healthcare=dentist': ['Dentist', 'Tandlæge', '🦷', 'health'], 'healthcare=doctor': ['Doctor', 'Læge', '🩺', 'health'],
  'healthcare=pharmacy': ['Pharmacy', 'Apotek', '💊', 'health'], 'healthcare=clinic': ['Clinic', 'Klinik', '⚕️', 'health'],
  'healthcare=hospital': ['Hospital', 'Hospital', '🏥', 'health'],
  // culture
  'amenity=theatre': ['Theatre', 'Teater', '🎭', 'culture'], 'amenity=cinema': ['Cinema', 'Biograf', '🎬', 'culture'],
  'amenity=arts_centre': ['Arts centre', 'Kulturhus', '🎨', 'culture'], 'amenity=community_centre': ['Community centre', 'Medborgerhus', '🏘️', 'culture'],
  'amenity=social_centre': ['Social centre', 'Socialt mødested', '☕', 'culture'], 'amenity=music_venue': ['Music venue', 'Spillested', '🎸', 'culture'],
  'amenity=events_venue': ['Events venue', 'Eventsted', '🎪', 'culture'], 'amenity=conference_centre': ['Conference centre', 'Konferencecenter', '🎤', 'culture'],
  'amenity=exhibition_centre': ['Exhibition centre', 'Udstillingscenter', '🖼️', 'culture'], 'amenity=planetarium': ['Planetarium', 'Planetarium', '🔭', 'culture'],
  'amenity=public_bookcase': ['Public bookcase', 'Bogbytte', '📚', 'culture'], 'amenity=studio': ['Studio', 'Studie', '🎙️', 'culture'],
  'tourism=museum': ['Museum', 'Museum', '🏛️', 'culture'], 'tourism=gallery': ['Art gallery', 'Galleri', '🖼️', 'culture'],
  'tourism=artwork': ['Artwork', 'Kunstværk', '🗿', 'culture'],
  // religion
  'amenity=place_of_worship': ['Place of worship', 'Gudshus / kirke', '⛪', 'religion'], 'amenity=monastery': ['Monastery', 'Kloster', '⛪', 'religion'],
  'amenity=grave_yard': ['Graveyard', 'Kirkegård', '🪦', 'religion'], 'amenity=crematorium': ['Crematorium', 'Krematorium', '🕯️', 'religion'],
  'amenity=funeral_hall': ['Funeral hall', 'Kapel / ceremonisal', '🕯️', 'religion'],
  // government & emergency
  'amenity=townhall': ['Town hall', 'Rådhus', '🏛️', 'government'], 'amenity=courthouse': ['Courthouse', 'Retsbygning', '⚖️', 'government'],
  'amenity=police': ['Police station', 'Politistation', '🚓', 'emergency'], 'amenity=fire_station': ['Fire station', 'Brandstation', '🚒', 'emergency'],
  'amenity=prison': ['Prison', 'Fængsel', '🔒', 'government'], 'amenity=embassy': ['Embassy', 'Ambassade', '🏳️', 'government'],
  'office=government': ['Government office', 'Offentligt kontor', '🏛️', 'government'], 'amenity=post_office': ['Post office', 'Posthus', '🏤', 'services'],
  'emergency=defibrillator': ['Defibrillator (AED)', 'Hjertestarter', '❤️', 'emergency'], 'emergency=fire_hydrant': ['Fire hydrant', 'Brandhane', '🧯', 'emergency'],
  'emergency=ambulance_station': ['Ambulance station', 'Ambulancestation', '🚑', 'emergency'], 'emergency=assembly_point': ['Assembly point', 'Samlingssted', '📍', 'emergency'],
  'emergency=phone': ['Emergency phone', 'Nødtelefon', '☎️', 'emergency'], 'emergency=lifeguard': ['Lifeguard', 'Livredder', '🛟', 'emergency'],
  // services & finance
  'amenity=bank': ['Bank', 'Bank', '🏦', 'finance'], 'amenity=atm': ['Cash machine (ATM)', 'Pengeautomat', '🏧', 'finance'],
  'amenity=bureau_de_change': ['Currency exchange', 'Vekselkontor', '💱', 'finance'], 'amenity=money_transfer': ['Money transfer', 'Pengeoverførsel', '💸', 'finance'],
  'amenity=post_box': ['Post box', 'Postkasse', '📮', 'services'], 'amenity=parcel_locker': ['Parcel locker', 'Pakkeboks', '📦', 'services'],
  'amenity=marketplace': ['Marketplace', 'Torvehandel', '🧺', 'shop'], 'amenity=toilets': ['Public toilets', 'Offentligt toilet', '🚻', 'services'],
  'amenity=drinking_water': ['Drinking water', 'Drikkevand', '🚰', 'services'], 'amenity=fountain': ['Fountain', 'Springvand', '⛲', 'leisure'],
  'amenity=bench': ['Bench', 'Bænk', '🪑', 'services'], 'amenity=shelter': ['Shelter', 'Læskur', '🛖', 'services'],
  'amenity=waste_basket': ['Waste bin', 'Skraldespand', '🗑️', 'services'], 'amenity=recycling': ['Recycling', 'Genbrugsstation / container', '♻️', 'services'],
  'amenity=waste_disposal': ['Waste disposal', 'Affaldscontainer', '🗑️', 'services'], 'amenity=vending_machine': ['Vending machine', 'Automat', '🥤', 'services'],
  'amenity=telephone': ['Telephone', 'Telefon', '☎️', 'services'], 'amenity=clock': ['Public clock', 'Ur', '🕰️', 'services'],
  'amenity=internet_cafe': ['Internet café', 'Internetcafé', '💻', 'services'], 'amenity=coworking_space': ['Coworking space', 'Kontorfællesskab', '💼', 'services'],
  'amenity=animal_shelter': ['Animal shelter', 'Dyreinternat', '🐕', 'services'], 'amenity=dog_toilet': ['Dog toilet', 'Hundetoilet', '🐕', 'services'],
  'amenity=bbq': ['Barbecue', 'Grill', '🔥', 'leisure'], 'amenity=hunting_stand': ['Hunting stand', 'Jagttårn', '🪜', 'leisure'],
  'amenity=gambling': ['Gambling', 'Spillehal', '🎰', 'leisure'], 'amenity=casino': ['Casino', 'Kasino', '🎰', 'leisure'],
  // transport
  'amenity=parking': ['Car park', 'Parkeringsplads', '🅿️', 'transport'], 'amenity=parking_entrance': ['Car park entrance', 'Indkørsel til parkering', '🅿️', 'transport'],
  'amenity=bicycle_parking': ['Bicycle parking', 'Cykelparkering', '🚲', 'transport'], 'amenity=bicycle_rental': ['Bicycle rental', 'Cykeludlejning', '🚲', 'transport'],
  'amenity=bicycle_repair_station': ['Bicycle repair station', 'Cykelpumpe / reparation', '🔧', 'transport'],
  'amenity=motorcycle_parking': ['Motorcycle parking', 'Motorcykelparkering', '🏍️', 'transport'], 'amenity=fuel': ['Petrol station', 'Tankstation', '⛽', 'transport'],
  'amenity=charging_station': ['EV charging', 'Ladestander', '🔌', 'transport'], 'amenity=car_wash': ['Car wash', 'Bilvask', '🧽', 'transport'],
  'amenity=car_rental': ['Car rental', 'Biludlejning', '🚙', 'transport'], 'amenity=car_sharing': ['Car sharing', 'Delebil', '🚙', 'transport'],
  'amenity=taxi': ['Taxi rank', 'Taxaholdeplads', '🚕', 'transport'], 'amenity=bus_station': ['Bus station', 'Busterminal', '🚌', 'transport'],
  'amenity=ferry_terminal': ['Ferry terminal', 'Færgeterminal', '⛴️', 'transport'], 'amenity=boat_rental': ['Boat rental', 'Bådudlejning', '🚤', 'transport'],
  'railway=station': ['Railway station', 'Togstation', '🚉', 'transport'], 'railway=halt': ['Railway halt', 'Trinbræt', '🚉', 'transport'],
  'railway=tram_stop': ['Light rail / tram stop', 'Letbanestation', '🚊', 'transport'], 'railway=platform': ['Platform', 'Perron', '🚉', 'transport'],
  'railway=subway_entrance': ['Subway entrance', 'Metroindgang', '🚇', 'transport'], 'railway=level_crossing': ['Level crossing', 'Jernbaneoverkørsel', '🚧', 'transport'],
  'railway=crossing': ['Railway foot crossing', 'Jernbaneovergang', '🚧', 'transport'], 'railway=buffer_stop': ['Buffer stop', 'Stopbuk', '🛑', 'transport'],
  'public_transport=station': ['Public transport station', 'Station', '🚉', 'transport'], 'public_transport=stop_position': ['Stop position', 'Stoppested', '🚏', 'transport'],
  'public_transport=platform': ['Stop / platform', 'Stoppested / perron', '🚏', 'transport'], 'highway=bus_stop': ['Bus stop', 'Busstoppested', '🚏', 'transport'],
  'highway=traffic_signals': ['Traffic signals', 'Lyskryds', '🚦', 'transport'], 'highway=crossing': ['Pedestrian crossing', 'Fodgængerovergang', '🚸', 'transport'],
  'highway=street_lamp': ['Street lamp', 'Gadelampe', '💡', 'infrastructure'], 'highway=stop': ['Stop sign', 'Stopskilt', '🛑', 'transport'],
  'highway=give_way': ['Give-way sign', 'Vigepligt', '🔻', 'transport'], 'highway=speed_camera': ['Speed camera', 'Fartkamera', '📸', 'transport'],
  'highway=elevator': ['Elevator', 'Elevator', '🛗', 'transport'], 'highway=turning_circle': ['Turning circle', 'Vendeplads', '↩️', 'transport'],
  'highway=mini_roundabout': ['Mini roundabout', 'Minirundkørsel', '🔄', 'transport'], 'highway=motorway_junction': ['Motorway junction', 'Motorvejsfrakørsel', '🛣️', 'transport'],
  'highway=traffic_mirror': ['Traffic mirror', 'Trafikspejl', '🪞', 'transport'], 'highway=milestone': ['Milestone', 'Milepæl', '🪨', 'transport'],
  // accommodation & tourism
  'tourism=hotel': ['Hotel', 'Hotel', '🏨', 'accommodation'], 'tourism=hostel': ['Hostel', 'Vandrerhjem / hostel', '🛏️', 'accommodation'],
  'tourism=guest_house': ['Guest house / B&B', 'Gæstehus / B&B', '🛏️', 'accommodation'], 'tourism=apartment': ['Holiday apartment', 'Ferielejlighed', '🛏️', 'accommodation'],
  'tourism=motel': ['Motel', 'Motel', '🏨', 'accommodation'], 'tourism=camp_site': ['Campsite', 'Campingplads', '⛺', 'accommodation'],
  'tourism=caravan_site': ['Caravan site', 'Autocamperplads', '🚐', 'accommodation'], 'tourism=attraction': ['Attraction', 'Seværdighed', '⭐', 'tourism'],
  'tourism=viewpoint': ['Viewpoint', 'Udsigtspunkt', '🔭', 'tourism'], 'tourism=information': ['Tourist information', 'Turistinformation', 'ℹ️', 'tourism'],
  'tourism=picnic_site': ['Picnic site', 'Picnicplads', '🧺', 'leisure'], 'tourism=theme_park': ['Theme park', 'Forlystelsespark', '🎢', 'leisure'],
  'tourism=zoo': ['Zoo', 'Zoologisk have', '🦁', 'leisure'], 'tourism=aquarium': ['Aquarium', 'Akvarium', '🐠', 'leisure'],
  // leisure & sport
  'leisure=park': ['Park', 'Park', '🌳', 'leisure'], 'leisure=garden': ['Garden', 'Have', '🌷', 'leisure'],
  'leisure=playground': ['Playground', 'Legeplads', '🛝', 'leisure'], 'leisure=pitch': ['Sports pitch', 'Boldbane', '⚽', 'sport'],
  'leisure=sports_centre': ['Sports centre', 'Idrætscenter', '🏋️', 'sport'], 'leisure=stadium': ['Stadium', 'Stadion', '🏟️', 'sport'],
  'leisure=fitness_centre': ['Gym', 'Fitnesscenter', '🏋️', 'sport'], 'leisure=fitness_station': ['Outdoor gym', 'Udendørs fitness', '💪', 'sport'],
  'leisure=swimming_pool': ['Swimming pool', 'Svømmebassin', '🏊', 'sport'], 'leisure=sports_hall': ['Sports hall', 'Idrætshal', '🏀', 'sport'],
  'leisure=track': ['Running track', 'Løbebane', '🏃', 'sport'], 'leisure=golf_course': ['Golf course', 'Golfbane', '⛳', 'sport'],
  'leisure=miniature_golf': ['Mini golf', 'Minigolf', '⛳', 'sport'], 'leisure=marina': ['Marina', 'Lystbådehavn', '⛵', 'leisure'],
  'leisure=slipway': ['Slipway', 'Bådrampe', '⛵', 'leisure'], 'leisure=dog_park': ['Dog park', 'Hundeskov / hundepark', '🐕', 'leisure'],
  'leisure=nature_reserve': ['Nature reserve', 'Naturreservat', '🦋', 'nature'], 'leisure=common': ['Common', 'Fælled', '🌾', 'leisure'],
  'leisure=picnic_table': ['Picnic table', 'Bord-bænkesæt', '🧺', 'leisure'], 'leisure=outdoor_seating': ['Outdoor seating', 'Udeservering', '🪑', 'food'],
  'leisure=sauna': ['Sauna', 'Sauna', '🧖', 'leisure'], 'leisure=bowling_alley': ['Bowling alley', 'Bowlinghal', '🎳', 'leisure'],
  'leisure=amusement_arcade': ['Amusement arcade', 'Spillehal', '🕹️', 'leisure'], 'leisure=escape_game': ['Escape room', 'Escape room', '🔐', 'leisure'],
  'leisure=dance': ['Dance hall', 'Dansested', '💃', 'leisure'], 'leisure=ice_rink': ['Ice rink', 'Skøjtebane', '⛸️', 'sport'],
  'leisure=water_park': ['Water park', 'Badeland', '🌊', 'leisure'], 'leisure=bandstand': ['Bandstand', 'Musiktribune', '🎺', 'leisure'],
  'leisure=firepit': ['Fire pit', 'Bålplads', '🔥', 'leisure'], 'leisure=horse_riding': ['Riding centre', 'Rideskole', '🐎', 'sport'],
  'leisure=beach_resort': ['Beach', 'Badestrand', '🏖️', 'leisure'], 'leisure=bathing_place': ['Bathing place', 'Badested', '🏊', 'leisure'],
  // offices
  'office=company': ['Company office', 'Firmakontor', '💼', 'services'], 'office=estate_agent': ['Estate agent', 'Ejendomsmægler', '🏠', 'services'],
  'office=insurance': ['Insurance office', 'Forsikringskontor', '🛡️', 'services'], 'office=lawyer': ['Lawyer', 'Advokat', '⚖️', 'services'],
  'office=accountant': ['Accountant', 'Revisor', '🧮', 'services'], 'office=architect': ['Architect', 'Arkitekt', '📐', 'services'],
  'office=it': ['IT company', 'IT-virksomhed', '💻', 'services'], 'office=educational_institution': ['Educational office', 'Uddannelseskontor', '🎓', 'education'],
  'office=research': ['Research office', 'Forskningskontor', '🔬', 'education'], 'office=ngo': ['NGO', 'NGO / organisation', '🤝', 'services'],
  'office=association': ['Association', 'Forening', '🤝', 'services'], 'office=employment_agency': ['Employment agency', 'Jobcenter / vikarbureau', '🧑‍💼', 'services'],
  'office=travel_agent': ['Travel agent', 'Rejsebureau', '✈️', 'services'], 'office=tax_advisor': ['Tax advisor', 'Skatterådgiver', '🧾', 'services'],
  'office=telecommunication': ['Telecom office', 'Telekontor', '📡', 'services'], 'office=newspaper': ['Newspaper', 'Avis', '📰', 'services'],
  'office=coworking': ['Coworking', 'Kontorfællesskab', '💼', 'services'], 'office=financial': ['Financial office', 'Finansvirksomhed', '💹', 'finance'],
  'office=consulting': ['Consultancy', 'Rådgivning', '💼', 'services'], 'office=political_party': ['Political party', 'Politisk parti', '🗳️', 'services'],
  'office=religion': ['Religious office', 'Kirkekontor', '⛪', 'religion'], 'office=foundation': ['Foundation', 'Fond', '🏛️', 'services'],
  'office=diplomatic': ['Diplomatic office', 'Diplomatisk repræsentation', '🏳️', 'government'], 'office=union': ['Trade union', 'Fagforening', '✊', 'services'],
  // shops
  'shop=supermarket': ['Supermarket', 'Supermarked', '🛒', 'shop'], 'shop=convenience': ['Convenience store', 'Kiosk / nærbutik', '🏪', 'shop'],
  'shop=bakery': ['Bakery', 'Bager', '🥐', 'shop'], 'shop=butcher': ['Butcher', 'Slagter', '🥩', 'shop'], 'shop=greengrocer': ['Greengrocer', 'Grønthandler', '🥕', 'shop'],
  'shop=seafood': ['Fishmonger', 'Fiskehandler', '🐟', 'shop'], 'shop=deli': ['Delicatessen', 'Delikatesse', '🧀', 'shop'], 'shop=cheese': ['Cheese shop', 'Ostehandler', '🧀', 'shop'],
  'shop=chocolate': ['Chocolatier', 'Chokoladebutik', '🍫', 'shop'], 'shop=confectionery': ['Sweet shop', 'Slikbutik', '🍬', 'shop'], 'shop=pastry': ['Patisserie', 'Konditori', '🍰', 'shop'],
  'shop=coffee': ['Coffee shop (beans)', 'Kaffebutik', '☕', 'shop'], 'shop=tea': ['Tea shop', 'Tebutik', '🍵', 'shop'], 'shop=wine': ['Wine shop', 'Vinhandel', '🍷', 'shop'],
  'shop=alcohol': ['Liquor store', 'Spiritusbutik', '🍾', 'shop'], 'shop=beverages': ['Drinks shop', 'Drikkevarer', '🥤', 'shop'], 'shop=kiosk': ['Kiosk', 'Kiosk', '🏪', 'shop'],
  'shop=department_store': ['Department store', 'Stormagasin', '🏬', 'shop'], 'shop=mall': ['Shopping centre', 'Indkøbscenter', '🏬', 'shop'],
  'shop=clothes': ['Clothes shop', 'Tøjbutik', '👕', 'shop'], 'shop=shoes': ['Shoe shop', 'Skobutik', '👟', 'shop'], 'shop=fashion_accessories': ['Accessories', 'Accessories', '👜', 'shop'],
  'shop=jewelry': ['Jeweller', 'Guldsmed', '💍', 'shop'], 'shop=watches': ['Watch shop', 'Urmager', '⌚', 'shop'], 'shop=bag': ['Bag shop', 'Taskebutik', '👜', 'shop'],
  'shop=boutique': ['Boutique', 'Butik', '👗', 'shop'], 'shop=second_hand': ['Second-hand shop', 'Genbrugsbutik', '♻️', 'shop'], 'shop=charity': ['Charity shop', 'Velgørenhedsbutik', '💝', 'shop'],
  'shop=variety_store': ['Variety store', 'Lavprisbutik', '🛍️', 'shop'], 'shop=books': ['Bookshop', 'Boghandel', '📖', 'shop'], 'shop=stationery': ['Stationery', 'Papirhandel', '✏️', 'shop'],
  'shop=newsagent': ['Newsagent', 'Bladkiosk', '📰', 'shop'], 'shop=gift': ['Gift shop', 'Gavebutik', '🎁', 'shop'], 'shop=toys': ['Toy shop', 'Legetøjsbutik', '🧸', 'shop'],
  'shop=games': ['Games shop', 'Spilbutik', '🎲', 'shop'], 'shop=video_games': ['Video games', 'Computerspil', '🎮', 'shop'], 'shop=music': ['Music shop', 'Pladebutik', '💿', 'shop'],
  'shop=musical_instrument': ['Instrument shop', 'Musikinstrumenter', '🎸', 'shop'], 'shop=art': ['Art shop', 'Kunsthandel', '🎨', 'shop'], 'shop=frame': ['Framing shop', 'Rammeværksted', '🖼️', 'shop'],
  'shop=photo': ['Photo shop', 'Fotobutik', '📷', 'shop'], 'shop=computer': ['Computer shop', 'Computerbutik', '💻', 'shop'], 'shop=electronics': ['Electronics', 'Elektronik', '📺', 'shop'],
  'shop=mobile_phone': ['Mobile phone shop', 'Mobiltelefoner', '📱', 'shop'], 'shop=hifi': ['Hi-fi shop', 'Hi-fi', '🔊', 'shop'], 'shop=appliance': ['Appliances', 'Hvidevarer', '🧺', 'shop'],
  'shop=furniture': ['Furniture', 'Møbelbutik', '🛋️', 'shop'], 'shop=interior_decoration': ['Interior decoration', 'Boligindretning', '🛋️', 'shop'], 'shop=kitchen': ['Kitchen shop', 'Køkkenforretning', '🍳', 'shop'],
  'shop=bed': ['Bed shop', 'Sengebutik', '🛏️', 'shop'], 'shop=lighting': ['Lighting', 'Lampeforretning', '💡', 'shop'], 'shop=houseware': ['Houseware', 'Isenkram', '🍽️', 'shop'],
  'shop=hardware': ['Hardware store', 'Isenkræmmer / jernhandel', '🔨', 'shop'], 'shop=doityourself': ['DIY store', 'Byggemarked', '🔨', 'shop'], 'shop=paint': ['Paint shop', 'Farvehandel', '🖌️', 'shop'],
  'shop=garden_centre': ['Garden centre', 'Planteskole / havecenter', '🌱', 'shop'], 'shop=florist': ['Florist', 'Blomsterhandler', '💐', 'shop'], 'shop=pet': ['Pet shop', 'Dyrehandel', '🐕', 'shop'],
  'shop=bicycle': ['Bicycle shop', 'Cykelhandler', '🚲', 'shop'], 'shop=sports': ['Sports shop', 'Sportsbutik', '⚽', 'shop'], 'shop=outdoor': ['Outdoor shop', 'Friluftsbutik', '🏕️', 'shop'],
  'shop=car': ['Car dealer', 'Bilforhandler', '🚘', 'shop'], 'shop=car_parts': ['Car parts', 'Autodele', '🔧', 'shop'], 'shop=car_repair': ['Car repair', 'Autoværksted', '🔧', 'shop'],
  'shop=tyres': ['Tyres', 'Dækforhandler', '🛞', 'shop'], 'shop=motorcycle': ['Motorcycle shop', 'Motorcykelforhandler', '🏍️', 'shop'], 'shop=optician': ['Optician', 'Optiker', '👓', 'shop'],
  'shop=chemist': ['Chemist / drugstore', 'Materialist', '🧴', 'shop'], 'shop=cosmetics': ['Cosmetics', 'Kosmetik', '💄', 'shop'], 'shop=perfumery': ['Perfumery', 'Parfumeri', '🌸', 'shop'],
  'shop=hairdresser': ['Hairdresser', 'Frisør', '💇', 'shop'], 'shop=beauty': ['Beauty salon', 'Skønhedssalon', '💅', 'shop'], 'shop=massage': ['Massage', 'Massage', '💆', 'shop'],
  'shop=tattoo': ['Tattoo studio', 'Tatovør', '🖋️', 'shop'], 'shop=nutrition_supplements': ['Supplements', 'Kosttilskud', '💊', 'shop'], 'shop=health_food': ['Health food', 'Helsekost', '🥗', 'shop'],
  'shop=medical_supply': ['Medical supplies', 'Hjælpemidler', '🩼', 'shop'], 'shop=hearing_aids': ['Hearing aids', 'Høreapparater', '👂', 'shop'], 'shop=travel_agency': ['Travel agency', 'Rejsebureau', '✈️', 'shop'],
  'shop=ticket': ['Ticket shop', 'Billetsalg', '🎟️', 'shop'], 'shop=laundry': ['Laundrette', 'Møntvask', '🧺', 'shop'], 'shop=dry_cleaning': ['Dry cleaner', 'Renseri', '👔', 'shop'],
  'shop=tailor': ['Tailor', 'Skrædder', '🧵', 'shop'], 'shop=copyshop': ['Copy shop', 'Kopicenter', '🖨️', 'shop'], 'shop=funeral_directors': ['Funeral director', 'Bedemand', '🕯️', 'shop'],
  'shop=pawnbroker': ['Pawnbroker', 'Pantelåner', '💰', 'shop'], 'shop=e-cigarette': ['Vape shop', 'E-cigaretter', '💨', 'shop'], 'shop=tobacco': ['Tobacconist', 'Tobakshandel', '🚬', 'shop'],
  'shop=lottery': ['Lottery', 'Lotto', '🎟️', 'shop'], 'shop=frozen_food': ['Frozen food', 'Frostvarer', '🧊', 'shop'], 'shop=farm': ['Farm shop', 'Gårdbutik', '🚜', 'shop'],
  'shop=wholesale': ['Wholesale', 'Engroshandel', '📦', 'shop'], 'shop=trade': ['Trade supplies', 'Byggevarer (erhverv)', '🧱', 'shop'], 'shop=electrical': ['Electrical supplies', 'El-artikler', '🔌', 'shop'],
  'shop=locksmith': ['Locksmith', 'Låsesmed', '🔑', 'shop'], 'shop=storage_rental': ['Storage rental', 'Depotrum', '📦', 'shop'], 'shop=fabric': ['Fabric shop', 'Stofbutik', '🧵', 'shop'],
  'shop=sewing': ['Sewing shop', 'Symaskiner', '🪡', 'shop'], 'shop=craft': ['Craft supplies', 'Hobbybutik', '✂️', 'shop'], 'shop=model': ['Model shop', 'Modelbutik', '🚂', 'shop'],
  'shop=antiques': ['Antiques', 'Antikvitetshandel', '🏺', 'shop'], 'shop=collector': ['Collectibles', 'Samlerbutik', '🪙', 'shop'], 'shop=vacant': ['Vacant shop', 'Tom butik', '🚪', 'shop'],
  'shop=hairdresser_supply': ['Hairdresser supplies', 'Frisørartikler', '💇', 'shop'], 'shop=carpet': ['Carpet shop', 'Tæpper', '🧶', 'shop'], 'shop=curtain': ['Curtain shop', 'Gardiner', '🪟', 'shop'],
  'shop=spices': ['Spice shop', 'Krydderier', '🌶️', 'shop'], 'shop=pasta': ['Pasta shop', 'Pastabutik', '🍝', 'shop'], 'shop=ice_cream': ['Ice cream shop', 'Isbutik', '🍦', 'shop'],
  'shop=water_sports': ['Water sports', 'Vandsport', '🏄', 'shop'], 'shop=fishing': ['Fishing tackle', 'Fiskegrej', '🎣', 'shop'], 'shop=weapons': ['Hunting / weapons', 'Våbenhandel', '🎯', 'shop'],
  // historic
  'historic=monument': ['Monument', 'Monument', '🗽', 'culture'], 'historic=memorial': ['Memorial', 'Mindesmærke', '🪦', 'culture'],
  'historic=castle': ['Castle', 'Slot / borg', '🏰', 'culture'], 'historic=archaeological_site': ['Archaeological site', 'Fortidsminde', '⛏️', 'culture'],
  'historic=ruins': ['Ruins', 'Ruin', '🏚️', 'culture'], 'historic=building': ['Historic building', 'Historisk bygning', '🏛️', 'culture'],
  'historic=church': ['Historic church', 'Historisk kirke', '⛪', 'culture'], 'historic=city_gate': ['City gate', 'Byport', '🚪', 'culture'],
  'historic=manor': ['Manor house', 'Herregård', '🏰', 'culture'], 'historic=wayside_cross': ['Wayside cross', 'Vejkors', '✝️', 'culture'],
  'historic=boundary_stone': ['Boundary stone', 'Skelsten', '🪨', 'culture'], 'historic=ship': ['Historic ship', 'Historisk skib', '⛵', 'culture'],
  'historic=tomb': ['Tomb', 'Gravmæle', '🪦', 'culture'], 'historic=milestone': ['Milestone', 'Milesten', '🪨', 'culture'],
  'historic=citywalls': ['City walls', 'Bymur', '🧱', 'culture'], 'historic=industrial': ['Industrial heritage', 'Industriminde', '🏭', 'culture'],
  // man-made
  'man_made=tower': ['Tower', 'Tårn', '🗼', 'infrastructure'], 'man_made=water_tower': ['Water tower', 'Vandtårn', '🗼', 'infrastructure'],
  'man_made=lighthouse': ['Lighthouse', 'Fyrtårn', '🗼', 'infrastructure'], 'man_made=chimney': ['Chimney', 'Skorsten', '🏭', 'infrastructure'],
  'man_made=mast': ['Mast', 'Mast', '📡', 'infrastructure'], 'man_made=antenna': ['Antenna', 'Antenne', '📡', 'infrastructure'],
  'man_made=crane': ['Crane', 'Kran', '🏗️', 'infrastructure'], 'man_made=pier': ['Pier', 'Mole / bådebro', '⚓', 'infrastructure'],
  'man_made=breakwater': ['Breakwater', 'Bølgebryder', '🌊', 'infrastructure'], 'man_made=bridge': ['Bridge', 'Bro', '🌉', 'infrastructure'],
  'man_made=works': ['Works / plant', 'Værk / anlæg', '🏭', 'infrastructure'], 'man_made=wastewater_plant': ['Wastewater plant', 'Rensningsanlæg', '💧', 'infrastructure'],
  'man_made=water_works': ['Water works', 'Vandværk', '💧', 'infrastructure'], 'man_made=windmill': ['Windmill', 'Vindmølle (historisk)', '🌬️', 'infrastructure'],
  'man_made=flagpole': ['Flagpole', 'Flagstang', '🚩', 'infrastructure'], 'man_made=surveillance': ['CCTV camera', 'Overvågningskamera', '📹', 'infrastructure'],
  'man_made=street_cabinet': ['Street cabinet', 'Teknikskab', '🗄️', 'infrastructure'], 'man_made=storage_tank': ['Storage tank', 'Tank', '🛢️', 'infrastructure'],
  'man_made=silo': ['Silo', 'Silo', '🛢️', 'infrastructure'], 'man_made=observatory': ['Observatory', 'Observatorium', '🔭', 'culture'],
  'man_made=telescope': ['Telescope', 'Teleskop', '🔭', 'culture'], 'man_made=obelisk': ['Obelisk', 'Obelisk', '🗿', 'culture'],
  'man_made=quay': ['Quay', 'Kaj', '⚓', 'infrastructure'], 'man_made=monitoring_station': ['Monitoring station', 'Målestation', '📈', 'infrastructure'],
  // craft
  'craft=brewery': ['Brewery', 'Bryggeri', '🍺', 'services'], 'craft=carpenter': ['Carpenter', 'Tømrer / snedker', '🪚', 'services'],
  'craft=electrician': ['Electrician', 'Elektriker', '⚡', 'services'], 'craft=plumber': ['Plumber', 'VVS-installatør', '🔧', 'services'],
  'craft=photographer': ['Photographer', 'Fotograf', '📷', 'services'], 'craft=shoemaker': ['Shoemaker', 'Skomager', '👞', 'services'],
  'craft=tailor': ['Tailor', 'Skrædder', '🧵', 'services'], 'craft=jeweller': ['Jeweller', 'Guldsmed', '💍', 'services'],
  'craft=painter': ['Painter', 'Maler', '🖌️', 'services'], 'craft=roofer': ['Roofer', 'Tagdækker', '🏠', 'services'],
  'craft=gardener': ['Gardener', 'Anlægsgartner', '🌿', 'services'], 'craft=winery': ['Winery', 'Vingård', '🍇', 'services'],
  'craft=distillery': ['Distillery', 'Destilleri', '🥃', 'services'], 'craft=confectionery': ['Confectioner', 'Konfekturemager', '🍬', 'services'],
  'craft=metal_construction': ['Metalworks', 'Smedje / metalværksted', '🔩', 'services'], 'craft=blacksmith': ['Blacksmith', 'Smed', '⚒️', 'services'],
  'craft=glaziery': ['Glazier', 'Glarmester', '🪟', 'services'], 'craft=bakery': ['Bakery (craft)', 'Bageri', '🥖', 'services'],
  'craft=caterer': ['Caterer', 'Catering', '🍱', 'services'], 'craft=key_cutter': ['Key cutter', 'Nøgleservice', '🔑', 'services'],
  // natural single features
  'natural=tree': ['Tree', 'Træ', '🌳', 'nature'], 'natural=peak': ['Hilltop', 'Bakketop', '⛰️', 'nature'], 'natural=spring': ['Spring', 'Kilde', '💧', 'nature'],
  'natural=stone': ['Boulder', 'Sten', '🪨', 'nature'], 'natural=beach': ['Beach', 'Strand', '🏖️', 'nature'], 'natural=cliff': ['Cliff', 'Klint', '🪨', 'nature']
};

// ------------------------------------------------------------------ roads
// highway: [English, Dansk, defaultWidth m, rank, motor traffic?]
const R = {
  motorway: ['Motorway', 'Motorvej', 11, 10, true], motorway_link: ['Motorway ramp', 'Motorvejsrampe', 6, 9, true],
  trunk: ['Trunk road', 'Hovedvej / motortrafikvej', 10, 9, true], trunk_link: ['Trunk link', 'Tilslutningsrampe', 6, 8, true],
  primary: ['Primary road', 'Primærvej (hovedfærdselsåre)', 9, 8, true], primary_link: ['Primary link', 'Tilslutning', 5.5, 7, true],
  secondary: ['Secondary road', 'Sekundærvej', 8, 7, true], secondary_link: ['Secondary link', 'Tilslutning', 5.5, 6, true],
  tertiary: ['Tertiary road', 'Fordelingsvej', 7, 6, true], tertiary_link: ['Tertiary link', 'Tilslutning', 5, 5, true],
  unclassified: ['Minor road', 'Mindre vej', 6, 4, true], residential: ['Residential street', 'Boligvej', 5.5, 4, true],
  living_street: ['Living street (shared space)', 'Opholds- og legeområde', 5, 3, true], service: ['Service / access road', 'Adgangsvej', 3.5, 2, true],
  pedestrian: ['Pedestrian street', 'Gågade', 7, 3, false], track: ['Track', 'Markvej / grusvej', 3, 1, true],
  busway: ['Busway', 'Busvej', 7, 5, true], bus_guideway: ['Bus guideway', 'Busbane', 7, 5, true], road: ['Road (type unknown)', 'Vej (ukendt type)', 6, 3, true],
  footway: ['Footpath', 'Gangsti / fortov', 2, 1, false], cycleway: ['Cycle path', 'Cykelsti', 2.3, 1, false], path: ['Path', 'Sti', 1.8, 1, false],
  bridleway: ['Bridleway', 'Ridesti', 2, 1, false], steps: ['Steps', 'Trappe', 2, 1, false], corridor: ['Indoor corridor', 'Gang (indendørs)', 2, 0, false],
  construction: ['Road under construction', 'Vej under anlæg', 6, 2, false], proposed: ['Proposed road', 'Planlagt vej', 6, 0, false],
  raceway: ['Raceway', 'Racerbane', 8, 1, false], platform: ['Bus platform', 'Perron', 3, 1, false], elevator: ['Elevator', 'Elevator', 2, 0, false]
};

// ------------------------------------------------------------------ land use / land cover
const L = {
  'landuse=residential': ['Residential area', 'Boligområde', '🏘️', 'residential'], 'landuse=commercial': ['Commercial area', 'Erhvervsområde', '🏬', 'commercial'],
  'landuse=retail': ['Retail area', 'Butiksområde', '🛍️', 'commercial'], 'landuse=industrial': ['Industrial area', 'Industriområde', '🏭', 'industrial'],
  'landuse=railway': ['Railway land', 'Jernbaneareal', '🚆', 'transport'], 'landuse=construction': ['Construction site', 'Byggeplads', '🏗️', 'other'],
  'landuse=brownfield': ['Brownfield', 'Byggetomt', '🚧', 'other'], 'landuse=greenfield': ['Greenfield', 'Udlagt byggeareal', '🌾', 'other'],
  'landuse=farmland': ['Farmland', 'Landbrugsjord', '🌾', 'nature'], 'landuse=farmyard': ['Farmyard', 'Gårdsplads', '🚜', 'agricultural'],
  'landuse=meadow': ['Meadow', 'Eng', '🌼', 'nature'], 'landuse=orchard': ['Orchard', 'Frugtplantage', '🍎', 'nature'],
  'landuse=allotments': ['Allotment gardens', 'Kolonihaver', '🥬', 'leisure'], 'landuse=cemetery': ['Cemetery', 'Kirkegård', '🪦', 'religion'],
  'landuse=forest': ['Forest', 'Skov', '🌲', 'nature'], 'landuse=grass': ['Grass', 'Græsareal', '🌱', 'nature'],
  'landuse=recreation_ground': ['Recreation ground', 'Rekreativt område', '⚽', 'leisure'], 'landuse=religious': ['Religious grounds', 'Kirkeareal', '⛪', 'religion'],
  'landuse=military': ['Military area', 'Militært område', '🪖', 'government'], 'landuse=garages': ['Garages area', 'Garageområde', '🚗', 'transport'],
  'landuse=education': ['Education campus', 'Uddannelsesområde', '🎓', 'education'], 'landuse=village_green': ['Village green', 'Gadekær / fællesareal', '🌳', 'leisure'],
  'landuse=flowerbed': ['Flowerbed', 'Blomsterbed', '🌷', 'nature'], 'landuse=plant_nursery': ['Plant nursery', 'Planteskole', '🌱', 'nature'],
  'landuse=basin': ['Basin', 'Bassin', '💧', 'water'], 'landuse=reservoir': ['Reservoir', 'Reservoir', '💧', 'water'],
  'landuse=quarry': ['Quarry', 'Grusgrav', '⛏️', 'industrial'], 'landuse=landfill': ['Landfill', 'Losseplads', '🗑️', 'industrial'],
  'landuse=port': ['Port area', 'Havneareal', '⚓', 'transport'], 'landuse=harbour': ['Harbour area', 'Havneareal', '⚓', 'transport'],
  'leisure=park': ['Park', 'Park', '🌳', 'leisure'], 'leisure=garden': ['Garden', 'Have', '🌷', 'leisure'], 'leisure=pitch': ['Sports pitch', 'Boldbane', '⚽', 'sport'],
  'leisure=playground': ['Playground', 'Legeplads', '🛝', 'leisure'], 'leisure=golf_course': ['Golf course', 'Golfbane', '⛳', 'sport'],
  'leisure=stadium': ['Stadium', 'Stadion', '🏟️', 'sport'], 'leisure=track': ['Running track', 'Løbebane', '🏃', 'sport'],
  'leisure=sports_centre': ['Sports centre', 'Idrætsanlæg', '🏋️', 'sport'], 'leisure=nature_reserve': ['Nature reserve', 'Naturreservat', '🦋', 'nature'],
  'leisure=dog_park': ['Dog park', 'Hundeskov', '🐕', 'leisure'], 'leisure=common': ['Common', 'Fælled', '🌾', 'leisure'], 'leisure=marina': ['Marina', 'Lystbådehavn', '⛵', 'leisure'],
  'natural=wood': ['Woodland', 'Skov', '🌳', 'nature'], 'natural=scrub': ['Scrub', 'Krat', '🌿', 'nature'], 'natural=heath': ['Heath', 'Hede', '🌾', 'nature'],
  'natural=grassland': ['Grassland', 'Græsland', '🌾', 'nature'], 'natural=beach': ['Beach', 'Strand', '🏖️', 'nature'], 'natural=sand': ['Sand', 'Sand', '🏜️', 'nature'],
  'natural=wetland': ['Wetland', 'Vådområde', '🦆', 'nature'], 'natural=bare_rock': ['Bare rock', 'Klippe', '🪨', 'nature'], 'natural=water': ['Water', 'Vand', '💧', 'water'],
  'waterway=riverbank': ['River', 'Å / flod', '💧', 'water'], 'amenity=parking': ['Car park', 'Parkeringsplads', '🅿️', 'transport'],
  'amenity=university': ['University campus', 'Universitetsområde', '🎓', 'education'], 'amenity=college': ['College campus', 'Uddannelsesområde', '🎓', 'education'],
  'amenity=school': ['School grounds', 'Skoleområde', '🏫', 'education'], 'amenity=kindergarten': ['Kindergarten grounds', 'Børnehaveområde', '🧸', 'education'],
  'amenity=hospital': ['Hospital grounds', 'Hospitalsområde', '🏥', 'health'], 'amenity=place_of_worship': ['Church grounds', 'Kirkeområde', '⛪', 'religion'],
  'amenity=grave_yard': ['Churchyard', 'Kirkegård', '🪦', 'religion'], 'amenity=prison': ['Prison grounds', 'Fængselsområde', '🔒', 'government'],
  'railway=station': ['Station area', 'Stationsområde', '🚉', 'transport'], 'public_transport=station': ['Station area', 'Stationsområde', '🚉', 'transport'],
  'tourism=zoo': ['Zoo', 'Zoologisk have', '🦁', 'leisure'], 'tourism=theme_park': ['Theme park', 'Forlystelsespark', '🎢', 'leisure'],
  'tourism=museum': ['Museum grounds', 'Museumsområde', '🏛️', 'culture'], 'man_made=wastewater_plant': ['Wastewater plant', 'Rensningsanlæg', '💧', 'infrastructure'],
  'power=plant': ['Power plant', 'Kraftværk', '⚡', 'infrastructure'], 'power=substation': ['Substation', 'Transformerstation', '⚡', 'infrastructure']
};

const GROUP_COLORS = {
  food: '#e8590c', shop: '#ae3ec9', transport: '#1c7ed6', education: '#f08c00', health: '#e03131', culture: '#7048e8',
  leisure: '#2f9e44', services: '#5c677d', religion: '#845ef7', accommodation: '#0c8599', emergency: '#c92a2a',
  finance: '#2b8a3e', government: '#364fc7', sport: '#37b24d', tourism: '#d6336c', infrastructure: '#868e96', nature: '#40c057',
  residential: '#c4a484', commercial: '#9775fa', industrial: '#868e96', civic: '#4263eb', agricultural: '#a9a35c',
  sports: '#37b24d', utility: '#868e96', minor: '#adb5bd', religious: '#845ef7', other: '#868e96', unknown: '#adb5bd', water: '#4dabf7'
};

// Facade colour palettes per style (deterministically chosen by seed) — tuned to Danish townscapes
const FACADE_PALETTES = {
  brick: ['#9c4a32', '#8a3f2c', '#a65a3e', '#7a3b2c', '#b06a48', '#c9a46a', '#b89463', '#8e5a43'],
  house: ['#a64b35', '#c69c6d', '#efe8da', '#d8c39a', '#b25b3d', '#f2efe6', '#7d4a33', '#e9d9b8'],
  plaster: ['#e8e2d6', '#efe7d2', '#e2c9a0', '#d9d4c7', '#f3eee4', '#d8b88f', '#cfd4d1'],
  concrete: ['#b5b3ab', '#a9a8a1', '#c4c1b6', '#9d9c97', '#bdb7aa'],
  glass: ['#8fa3b3', '#7f93a3', '#9aaab5', '#6f8596'],
  metal: ['#c3c8cc', '#9aa6ad', '#b8bec2', '#7c8c99', '#d0d2cf', '#5f7482'],
  historic: ['#a14e36', '#efe8da', '#d9c9a3', '#8c3f2d', '#e6dcc8'],
  retail: ['#e6e0d5', '#b85a3e', '#d4cbbd', '#c2b49c', '#9e9b93'],
  plain: ['#b8b2a6', '#a7a399', '#8e8a82', '#c9c3b8']
};

const ROOF_DEFAULTS = {
  flat: ['#6f6d68', '#7c7a74', '#5d5c58', '#8a8780'],
  pitched: ['#9a3b2b', '#a8452f', '#4a4c50', '#3b3d40', '#b04e33', '#2f3133', '#8a3a2c']
};

// ------------------------------------------------------------------ helpers
const FUNCTION_KEYS = ['amenity', 'shop', 'tourism', 'office', 'healthcare', 'railway', 'public_transport', 'leisure', 'historic', 'man_made', 'craft', 'emergency'];
const GENERIC_BUILDINGS = new Set(['yes', 'commercial', 'retail', 'civic', 'public', 'industrial', 'service', 'office', 'roof', 'construction', 'transportation', 'government']);

// name-based inference (word endings typical in Danish names)
const NAME_HINTS = [
  [/(dom)?kirke\b|\bkapel\b|\bchurch\b|\bcathedral\b/i, 'church'],
  [/universitet\b|\buniversity\b/i, 'university'],
  [/skole\b|\bgymnasium\b|\bschool\b|\bseminarium\b|akademi\b|\bacademy\b/i, 'school'],
  [/\bbørnehave\b|\bvuggestue\b|\bdaginstitution\b|\bbørnehus\b/i, 'kindergarten'],
  [/hospital\b|\bsygehus\b|\bklinik\b/i, 'hospital'],
  [/\bbanegård\b|\bstation\b|\baarhus h\b/i, 'train_station'],
  [/\bhotel\b/i, 'hotel'],
  [/museum\b|\bkunsthal\b|\bgalleri\b/i, 'museum'],
  [/bibliotek\b|\blibrary\b|\bdokk1\b/i, 'library'],
  [/kollegi(um|et)\b|\bdormitory\b/i, 'dormitory'],
  [/rådhus\b|\btown ?hall\b/i, 'townhall'],
  [/\bteater\b|\bteatret\b|\btheatre\b|\bmusikhus(et)?\b/i, 'theatre'],
  [/\bstadion\b|\bidrætshal\b|\bhallen\b/i, 'sports_hall'],
  [/\bplejehjem\b|\bplejecenter\b/i, 'nursing_home'],
  [/\bbrandstation\b/i, 'fire_station'],
  [/\bparkeringshus\b|\bp-hus\b/i, 'parking']
];

function pick(arr, seed) { return arr[Math.abs(Math.floor(seed)) % arr.length]; }

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

function buildingInfo(value) {
  const e = B[value];
  if (!e) return null;
  return { key: value, label: e[0], labelDa: e[1], icon: e[2], group: e[3], style: e[4], levels: e[5], roof: e[6] };
}

function poiInfo(key) {
  const e = P[key];
  if (!e) return null;
  return { key, label: e[0], labelDa: e[1], icon: e[2], group: e[3], color: GROUP_COLORS[e[3]] || '#868e96' };
}

/** Find the most specific function (amenity=…, shop=…) on a tag set. */
function functionOf(tags) {
  const found = [];
  for (const k of FUNCTION_KEYS) {
    const v = tags && tags[k];
    if (!v || v === 'no') continue;
    for (const part of String(v).split(';')) {
      const key = `${k}=${part.trim()}`;
      const info = poiInfo(key);
      if (info) found.push(info);
      else if (k !== 'railway' && k !== 'public_transport' && k !== 'leisure') {
        found.push({ key, label: prettyValue(part.trim()), labelDa: prettyValue(part.trim()), icon: '📍', group: 'services', color: GROUP_COLORS.services });
      }
    }
  }
  return found;
}

function prettyValue(v) { return String(v).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }

const NAME_TO_BUILDING = { theatre: 'civic', nursing_home: 'residential' };

/**
 * Classify a building (or building:part).
 * @param {object} tags  OSM tags
 * @param {object} [ctx] optional context { kind:'amenity=university', name:'Aarhus Universitet' } of the enclosing area
 */
function classifyBuilding(tags, ctx) {
  tags = tags || {};
  const isPart = !tags.building && !!tags['building:part'];
  const bval = String(tags.building || (isPart ? (tags['building:part'] === 'yes' ? 'yes' : tags['building:part']) : 'yes')).split(';')[0].trim();
  const base = buildingInfo(bval) || { ...buildingInfo('yes'), key: bval, label: prettyValue(bval), labelDa: prettyValue(bval) };
  const funcs = functionOf(tags);
  const name = tags.name || tags['name:da'] || null;
  let result = { ...base, kind: base.key, confidence: bval === 'yes' ? 'unknown' : 'tagged', note: null, also: [] };

  if (funcs.length) {
    const main = funcs[0];
    if (GENERIC_BUILDINGS.has(bval)) {
      // the function is the most useful answer to "what is this?"
      result = { ...result, label: main.label, labelDa: main.labelDa, icon: main.icon, group: main.group, confidence: 'tagged', func: main.key };
      if (bval !== 'yes') result.also.push(base.label);
      result.also.push(...funcs.slice(1).map(f => f.label));
    } else {
      result.also.push(...funcs.map(f => f.label));
      result.func = main.key;
    }
  } else if (bval === 'yes') {
    // 1) name hints
    let hinted = null;
    if (name) for (const [re, kind] of NAME_HINTS) { if (re.test(name)) { hinted = kind; break; } }
    if (hinted) {
      const bi = buildingInfo(hinted) || buildingInfo(NAME_TO_BUILDING[hinted] || 'yes');
      const label = hinted === 'theatre' ? 'Theatre / concert hall' : hinted === 'nursing_home' ? 'Nursing home' : bi.label;
      const labelDa = hinted === 'theatre' ? 'Teater / koncertsal' : hinted === 'nursing_home' ? 'Plejehjem' : bi.labelDa;
      result = { ...result, ...bi, kind: bi.key, label, labelDa, confidence: 'name', note: `Inferred from the name "${name}"` };
    } else if (ctx && ctx.kind) {
      // 2) surrounding area
      const c = CONTEXT_TO_BUILDING[ctx.kind];
      if (c) {
        const bi = buildingInfo(c[0]);
        result = { ...result, ...bi, kind: bi.key, label: c[1], labelDa: c[2], confidence: 'context',
          note: `Inferred from the surrounding area${ctx.name ? `: ${ctx.name}` : ''} (${(L[ctx.kind] || [ctx.kind])[0].toLowerCase()})` };
      }
    }
  }
  if (isPart) { result.part = true; result.note = [result.note, 'Part of a larger building (3D detail)'].filter(Boolean).join(' · '); }
  if (tags['disused:shop'] || tags['disused:amenity']) result.also.push('Former ' + prettyValue(tags['disused:shop'] || tags['disused:amenity']).toLowerCase());
  if (tags.heritage || tags['heritage:operator']) result.also.push('Listed / protected building');
  return result;
}

// enclosing-area kind → [building kind, English label, Danish label]
const CONTEXT_TO_BUILDING = {
  'amenity=university': ['university', 'University building', 'Universitetsbygning'],
  'amenity=college': ['college', 'College building', 'Uddannelsesbygning'],
  'amenity=school': ['school', 'School building', 'Skolebygning'],
  'amenity=kindergarten': ['kindergarten', 'Kindergarten building', 'Børnehavebygning'],
  'amenity=hospital': ['hospital', 'Hospital building', 'Hospitalsbygning'],
  'amenity=place_of_worship': ['religious', 'Church / parish building', 'Kirkelig bygning'],
  'amenity=grave_yard': ['chapel', 'Cemetery building', 'Kirkegårdsbygning'],
  'amenity=prison': ['civic', 'Prison building', 'Fængselsbygning'],
  'railway=station': ['train_station', 'Station building', 'Stationsbygning'],
  'public_transport=station': ['transportation', 'Station building', 'Stationsbygning'],
  'landuse=residential': ['residential', 'Residential building', 'Beboelsesbygning'],
  'landuse=commercial': ['commercial', 'Commercial building', 'Erhvervsbygning'],
  'landuse=retail': ['retail', 'Retail building', 'Butiksbygning'],
  'landuse=industrial': ['industrial', 'Industrial building', 'Industribygning'],
  'landuse=railway': ['service', 'Railway building', 'Jernbanebygning'],
  'landuse=military': ['military', 'Military building', 'Militær bygning'],
  'landuse=religious': ['religious', 'Church building', 'Kirkelig bygning'],
  'landuse=cemetery': ['chapel', 'Cemetery building', 'Kirkegårdsbygning'],
  'landuse=allotments': ['allotment_house', 'Allotment cabin', 'Kolonihavehus'],
  'landuse=farmyard': ['farm_auxiliary', 'Farm building', 'Landbrugsbygning'],
  'landuse=garages': ['garages', 'Garages', 'Garageanlæg'],
  'landuse=education': ['school', 'Education building', 'Uddannelsesbygning'],
  'landuse=port': ['warehouse', 'Port building', 'Havnebygning'],
  'landuse=harbour': ['warehouse', 'Harbour building', 'Havnebygning'],
  'tourism=zoo': ['service', 'Zoo building', 'Zoo-bygning'],
  'tourism=theme_park': ['service', 'Theme park building', 'Forlystelsesbygning'],
  'tourism=museum': ['museum', 'Museum building', 'Museumsbygning'],
  'leisure=sports_centre': ['sports_hall', 'Sports building', 'Idrætsbygning'],
  'leisure=stadium': ['stadium', 'Stadium building', 'Stadionbygning'],
  'leisure=park': ['pavilion', 'Park building', 'Parkbygning'],
  'leisure=marina': ['boathouse', 'Marina building', 'Havnebygning (lystbåde)'],
  'man_made=wastewater_plant': ['service', 'Wastewater plant building', 'Rensningsanlæg'],
  'power=plant': ['industrial', 'Power plant building', 'Kraftværksbygning'],
  'power=substation': ['service', 'Substation building', 'Transformerstation']
};
const CONTEXT_KINDS = Object.keys(CONTEXT_TO_BUILDING);

function classifyPoi(tags) {
  const f = functionOf(tags);
  if (f.length) return { ...f[0], also: f.slice(1).map(x => x.label), confidence: 'tagged' };
  if (tags && tags.natural === 'tree') return { ...poiInfo('natural=tree'), also: [], confidence: 'tagged' };
  if (tags && tags.highway && P['highway=' + tags.highway]) return { ...poiInfo('highway=' + tags.highway), also: [], confidence: 'tagged' };
  if (tags && tags.natural && P['natural=' + tags.natural]) return { ...poiInfo('natural=' + tags.natural), also: [], confidence: 'tagged' };
  return { key: 'place', label: 'Place', labelDa: 'Sted', icon: '📍', group: 'services', color: GROUP_COLORS.services, also: [], confidence: 'unknown' };
}

function roadInfo(highway) {
  const e = R[highway];
  if (!e) return { key: highway || 'road', label: prettyValue(highway || 'road'), labelDa: prettyValue(highway || 'vej'), width: 5, rank: 2, motor: true };
  return { key: highway, label: e[0], labelDa: e[1], width: e[2], rank: e[3], motor: e[4] };
}

/** Best-guess carriageway width in metres for a highway way. */
function roadWidth(tags) {
  const parseLen = (v) => { const m = String(v || '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const w = parseLen(tags.width) || parseLen(tags.est_width);
  if (w && w > 0.8 && w < 60) return w;
  const info = roadInfo(tags.highway);
  const lanes = parseLen(tags.lanes);
  if (lanes && info.motor) return Math.max(info.width * 0.6, Math.min(lanes * 3.25, 30));
  if (tags.highway === 'footway' && tags.footway === 'sidewalk') return 2;
  return info.width;
}

function landuseInfo(tags) {
  for (const k of ['leisure', 'landuse', 'natural', 'amenity', 'tourism', 'railway', 'public_transport', 'man_made', 'power', 'waterway']) {
    const v = tags && tags[k];
    if (v && L[`${k}=${v}`]) { const e = L[`${k}=${v}`]; return { key: `${k}=${v}`, label: e[0], labelDa: e[1], icon: e[2], group: e[3] }; }
  }
  return null;
}

module.exports = {
  BUILDINGS: B, POIS: P, ROADS: R, LANDUSE: L, GROUP_COLORS, FACADE_PALETTES, ROOF_DEFAULTS, CONTEXT_KINDS, CONTEXT_TO_BUILDING,
  buildingInfo, poiInfo, functionOf, classifyBuilding, classifyPoi, roadInfo, roadWidth, landuseInfo, hashString, pick, prettyValue
};
