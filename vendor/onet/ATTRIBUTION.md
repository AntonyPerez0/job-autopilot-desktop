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
