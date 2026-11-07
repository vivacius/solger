import sys
sys.path.insert(0, 'backend')
from fusionsolar import fusion_client
from datetime import datetime

plants = fusion_client.get_plant_list()
code = plants['data']['list'][0]['plantCode']
today = datetime.now().strftime('%Y%m%d')
month = datetime.now().strftime('%Y%m')
ts_day = int(datetime.strptime(today, '%Y%m%d').timestamp() * 1000)
ts_month = int(datetime.strptime(month + '01', '%Y%m%d').timestamp() * 1000)

endpoints = [
    ('/thirdData/getKpiStationHour', {'stationCodes': code, 'collectTime': ts_day}),
    ('/thirdData/getKpiStationDay', {'stationCodes': code, 'collectTime': ts_day}),
    ('/thirdData/getKpiStationMonth', {'stationCodes': code, 'collectTime': ts_month}),
]

for ep, payload in endpoints:
    try:
        r = fusion_client._post(ep, payload)
        err = r.get('error_code', '')
        fail = r.get('failCode', '')
        d = len(r.get('data') or [])
        print(f"{ep}: failCode={fail} errCode={err} dataLen={d}")
        if d > 0:
            print("  First item:", r['data'][0])
    except Exception as e:
        print(f"{ep}: EXCEPTION {e}")
