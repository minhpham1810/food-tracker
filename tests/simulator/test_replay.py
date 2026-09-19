from pathlib import Path
import pytest
from simulator.mendeley_replay import load_mendeley_csv


def test_replay_adapter_reads_documented_columns(tmp_path: Path):
    csv = tmp_path / "beef.csv"
    csv.write_text(
        "Minute,TVC,Label,MQ135,Temperature,Humidity\n"
        "0,2.5,Excellent,200000,4.0,60\n"
        "1,3.2,Good,180000,4.1,61\n",
        encoding="utf-8",
    )
    rows = load_mendeley_csv(csv, "MQ135")
    assert [x.timestamp for x in rows] == [0.0, 60.0]
    assert rows[-1].gas_resistance == 180000.0


def test_replay_adapter_selects_first_mq_column(tmp_path: Path):
    csv = tmp_path / "beef.csv"
    csv.write_text("Minute,MQ2,Temperature,Humidity\n0,200000,4.0,60\n", encoding="utf-8")
    assert load_mendeley_csv(csv)[0].gas_resistance == 200000.0


def test_replay_adapter_rejects_non_positive_gas(tmp_path: Path):
    csv = tmp_path / "bad.csv"
    csv.write_text("Minute,MQ2,Temperature,Humidity\n0,0,4.0,60\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_mendeley_csv(csv)
