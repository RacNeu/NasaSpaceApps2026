"""The sectors of the console beyond the detailed Southeast Asia study area.

Each sector is a bounding box, a grid cell size and a list of countries. Detections come from the
FIRMS yearly country files, so each detection's country is official FIRMS attribution and no
hand-drawn outline is needed. Large countries use 1 degree cells to keep the website's files small.
"""

# (FIRMS file name, display name, colour)
SECTORS = {
    "mainland_sea": {
        "name": "Mainland Southeast Asia",
        "short": "Mainland SE Asia",
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
}

# FIRMS country-file sensor folders and the years each exists for
SENSOR_FOLDERS = {
    "modis": ("modis", range(2001, 2026)),
    "snpp": ("viirs-snpp", range(2012, 2026)),
    "noaa20": ("viirs-jpss1", range(2018, 2026)),
}
