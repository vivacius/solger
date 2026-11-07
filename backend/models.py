"""
Schemas Pydantic para las respuestas del proxy SOLGER.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class PlantInfo(BaseModel):
    plantCode: str
    plantName: str
    capacity: float
    latitude: str | None = None
    longitude: str | None = None
    plantAddress: str | None = None
    gridConnectionDate: str | None = None
    contactPerson: str | None = None
    contactMethod: str | None = None


class PlantRealKpi(BaseModel):
    plantCode: str
    dataItemMap: dict[str, Any] = {}


class DeviceInfo(BaseModel):
    id: str | int
    devName: str
    devTypeId: int | None = None
    softwareVersion: str | None = None
    invType: str | None = None
    portName: str | None = None


class AlarmItem(BaseModel):
    alarmId: str | None = None
    alarmName: str | None = None
    alarmCause: str | None = None
    stationCode: str | None = None
    devName: str | None = None
    alarmDevTypeId: int | None = None
    repairSuggestion: str | None = None
    raiseTime: int | None = None


class PortfolioSummary(BaseModel):
    totalCapacity_kWp: float
    totalPlants: int
    activePlants: int
    totalEnergyToday_kWh: float
    totalEnergyMonth_kWh: float
    totalEnergyTotal_kWh: float
    co2Avoided_ton: float
    lastUpdated: str
