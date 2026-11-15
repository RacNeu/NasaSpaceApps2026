"""The sectors of the console beyond the detailed Southeast Asia study area.

Each sector is a bounding box, a grid cell size and a list of countries. Detections come from the
FIRMS yearly country files, so each detection's country is official FIRMS attribution and no
hand-drawn outline is needed. Large countries use 1 degree cells to keep the website's files small.
"""

# (FIRMS file name, display name, colour)
SECTORS = {
    "mainland_sea": {
        "name": "Mainland Southeast Asia",
        "short": "Mainland Southeast Asia",
        "group": "Asia",
        "box": [92.0, 5.0, 110.0, 29.0],
        "cell": 0.5,
        "countries": [
            ("Thailand", "Thailand", "#f4a259"),
            ("Myanmar", "Myanmar", "#e5484d"),
            ("Lao_PDR", "Laos", "#8e4ec6"),
            ("Cambodia", "Cambodia", "#30a46c"),
            ("Vietnam", "Vietnam", "#3e9bd6"),
        ],
        "story": "The February to April burning season of farms and forests across the mainland.",
    },
    "australia": {
        "name": "Australia",
        "short": "Australia",
        "group": "Oceania",
        "box": [112.0, -44.0, 154.0, -10.0],
        "cell": 1.0,
        "countries": [("Australia", "Australia", "#f4a259")],
        "story": "Savanna fires every dry season in the north, and the 2019-20 bushfires in the south-east.",
    },
    "brazil": {
        "name": "Brazil",
        "short": "Brazil",
        "group": "Americas",
        "box": [-74.0, -34.0, -34.0, 6.0],
        "cell": 1.0,
        "countries": [("Brazil", "Brazil", "#30a46c")],
        "story": "Fires linked to deforestation in the Amazon and to the Cerrado savanna.",
    },
    "united_states": {
        "name": "United States",
        "short": "United States",
        "group": "Americas",
        "box": [-170.0, 18.0, -65.0, 72.0],
        "cell": 1.0,
        "countries": [("United_States", "United States", "#3e9bd6")],
        "story": "Western wildfire seasons, including California's record years, and agricultural burning in the south-east.",
    },
    "canada": {
        "name": "Canada",
        "short": "Canada",
        "group": "Americas",
        "box": [-141.0, 41.0, -52.0, 84.0],
        "cell": 1.0,
        "countries": [("Canada", "Canada", "#e5484d")],
        "story": "Boreal forest fires, including the record 2023 season.",
    },
    "india": {
        "name": "India",
        "short": "India",
        "group": "Asia",
        "box": [68.0, 6.0, 98.0, 37.5],
        "cell": 1.0,
        "countries": [("India", "India", "#f4a259")],
        # Suomi NPP only up to 2019: NOAA-20 is the reference from 2018, and 2018-19 calibrates NPP onto it
        "sensor_years": {"snpp": range(2012, 2020)},
        "story": "Crop-residue burning in Punjab and Haryana after the harvest, forest fires in the centre and the north-east.",
    },
    "central_africa": {
        "name": "Central Africa: northern savanna",
        "short": "Central Africa",
        "group": "Africa",
        "box": [13.0, 2.0, 36.0, 16.0],
        "cell": 1.0,
        # DR Congo is left out for now: its files alone are nearly half of the download
        "sensor_years": {"snpp": range(2012, 2020)},
        "countries": [
            ("Central_African_Republic", "Central African Republic", "#f4a259"),
            ("South_Sudan", "South Sudan", "#e5484d"),
            ("Sudan", "Sudan", "#8e4ec6"),
            ("Chad", "Chad", "#3e9bd6"),
        ],
        "story": "The savanna belt that burns most on Earth: dry-season fires that sweep north and south of the equator each year.",
    },
}


# Single-country sectors are split into well-known groups of states, so every view and the
# forecast can tell them apart. (display name, colour, Natural Earth admin-1 names, accents dropped)
SUBREGIONS = {
    "united_states": {
        "admin": "United States of America",
        "groups": [
            ("West Coast", "#f4a259", ['Washington', 'Oregon', 'California']),
            ("Interior West", "#e5484d", ['Idaho', 'Montana', 'Wyoming', 'Nevada', 'Utah', 'Colorado', 'Arizona', 'New Mexico']),
            ("Great Plains and Texas", "#8e4ec6", ['North Dakota', 'South Dakota', 'Nebraska', 'Kansas', 'Oklahoma', 'Texas']),
            ("Southeast", "#30a46c", ['Arkansas', 'Louisiana', 'Mississippi', 'Alabama', 'Georgia', 'Florida', 'South Carolina', 'North Carolina', 'Tennessee', 'Kentucky', 'Virginia', 'West Virginia']),
            ("Midwest and Northeast", "#3e9bd6", ['Minnesota', 'Iowa', 'Missouri', 'Wisconsin', 'Illinois', 'Indiana', 'Michigan', 'Ohio', 'Pennsylvania', 'New York', 'New Jersey', 'Delaware', 'Maryland', 'District of Columbia', 'Connecticut', 'Rhode Island', 'Massachusetts', 'Vermont', 'New Hampshire', 'Maine']),
            ("Alaska and Hawaii", "#e8c547", ['Alaska', 'Hawaii']),
        ],
    },
    "canada": {
        "admin": "Canada",
        "groups": [
            ("British Columbia", "#f4a259", ['British Columbia']),
            ("Prairies", "#e5484d", ['Alberta', 'Saskatchewan', 'Manitoba']),
            ("Ontario and Quebec", "#8e4ec6", ['Ontario', 'Quebec']),
            ("Atlantic", "#30a46c", ['New Brunswick', 'Nova Scotia', 'Prince Edward Island', 'Newfoundland and Labrador']),
            ("The North", "#3e9bd6", ['Yukon', 'Northwest Territories', 'Nunavut']),
        ],
    },
    "australia": {
        "admin": "Australia",
        "groups": [
            ("Northern Territory", "#f4a259", ['Northern Territory']),
            ("Queensland", "#e5484d", ['Queensland']),
            ("Western Australia", "#8e4ec6", ['Western Australia']),
            ("New South Wales and ACT", "#30a46c", ['New South Wales', 'Australian Capital Territory', 'Jervis Bay Territory', 'Lord Howe Island']),
            ("South: Victoria, Tasmania, SA", "#3e9bd6", ['Victoria', 'Tasmania', 'South Australia', 'Macquarie Island']),
        ],
    },
    "brazil": {
        "admin": "Brazil",
        "groups": [
            ("North", "#f4a259", ['Acre', 'Amapa', 'Amazonas', 'Para', 'Rondonia', 'Roraima', 'Tocantins']),
            ("Northeast", "#e5484d", ['Alagoas', 'Bahia', 'Ceara', 'Maranhao', 'Paraiba', 'Pernambuco', 'Piaui', 'Rio Grande do Norte', 'Sergipe']),
            ("Centre-West", "#8e4ec6", ['Distrito Federal', 'Goias', 'Mato Grosso', 'Mato Grosso do Sul']),
            ("Southeast", "#30a46c", ['Espirito Santo', 'Minas Gerais', 'Rio de Janeiro', 'Sao Paulo']),
            ("South", "#3e9bd6", ['Parana', 'Rio Grande do Sul', 'Santa Catarina']),
        ],
    },
    "india": {
        "admin": "India",
        "groups": [
            ("North", "#f4a259", ['Jammu and Kashmir', 'Ladakh', 'Himachal Pradesh', 'Punjab', 'Haryana', 'Chandigarh', 'Delhi', 'Uttarakhand', 'Uttar Pradesh']),
            ("West", "#e5484d", ['Rajasthan', 'Gujarat', 'Maharashtra', 'Goa', 'Dadra and Nagar Haveli and Daman and Diu']),
            ("Central", "#8e4ec6", ['Madhya Pradesh', 'Chhattisgarh']),
            ("East", "#30a46c", ['Bihar', 'Jharkhand', 'Odisha', 'West Bengal']),
            ("Northeast", "#3e9bd6", ['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura', 'Sikkim']),
            ("South", "#e8c547", ['Andhra Pradesh', 'Telangana', 'Karnataka', 'Kerala', 'Tamil Nadu', 'Puducherry', 'Lakshadweep', 'Andaman and Nicobar']),
        ],
    },
}

# FIRMS country-file sensor folders and the years each exists for
SENSOR_FOLDERS = {
    "modis": ("modis", range(2001, 2026)),
    "snpp": ("viirs-snpp", range(2012, 2026)),
    "noaa20": ("viirs-jpss1", range(2018, 2026)),
}
