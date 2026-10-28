# Job task lists

`onet.json.gz` includes information from the O*NET 31.0 Database by the U.S.
Department of Labor, Employment and Training Administration (USDOL/ETA), used
under the CC BY 4.0 license (https://creativecommons.org/licenses/by/4.0/).
O*NET® is a trademark of USDOL/ETA.

Changes made: only the task statements (core tasks first, ordered by their
importance rating, at most 30 per occupation), occupation titles, job titles and
reported job titles are kept, in a compact JSON format. In the app, an AI model
rewords tasks into yes/no questions.
Source: https://www.onetcenter.org/database.html

# Move up: related jobs, preparation and pay

`ladder.json.gz` (built by `scripts/build-ladder.py`) includes:
- Related Occupations and Job Zones from the O*NET 31.0 Database by the U.S. Department of Labor,
  Employment and Training Administration (USDOL/ETA), used under the CC BY 4.0 license. O*NET® is a
  trademark of USDOL/ETA.
- Median hourly wages and employment by state from the U.S. Bureau of Labor Statistics, Occupational
  Employment and Wage Statistics (OEWS), May 2025 (public domain). The "US" figure is an
  employment-weighted average of the state medians.

# Sorting skills: software names

`software.json.gz` (built by `scripts/build-software.py`) holds the names of software from O*NET's
Software Skills ("Workplace Example") in the O*NET 31.0 Database by the U.S. Department of Labor,
Employment and Training Administration (USDOL/ETA), used under the CC BY 4.0 license. O*NET® is a
trademark of USDOL/ETA.

Changes made: names only (lower case), plus each product without its maker ("excel" for "Microsoft
Excel"), the maker alone where it isn't an everyday word, and the name without "software"; names that
are only everyday words are left out; a few common products O*NET doesn't list are added. The app uses
the list to put a skill under Software & Systems without asking an AI.
