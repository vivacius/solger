import sys, requests
sys.path.insert(0, 'backend')
from config import settings

print('BASE_URL:', settings.BASE_URL)

session = requests.Session()
session.headers.update({
    'Accept': 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
    'User-Agent': 'SOLGER-Dashboard/1.0',
})

# Login
resp = session.post(
    f'{settings.BASE_URL}/thirdData/login',
    json={'userName': settings.USERNAME, 'systemCode': settings.PASSWORD},
    timeout=20,
    verify=settings.VERIFY_SSL,
)
print('Login status:', resp.status_code)
print('Login response headers:', dict(resp.headers))
print('Login cookies:', dict(resp.cookies))
print('Session cookies:', dict(session.cookies))
print('Login body:', resp.text[:500])
