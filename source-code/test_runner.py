#!/usr/bin/env python3
"""
Automated Test Runner for LTPForge Pro
Verifies SDNV encoding, Red/Green block partitioning, Checkpoint flag assembly, CRC-16 X.25, and 10-point normative auditor.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ltp_cli import encode_sdnv, segment_block, audit_ltp, crc16_x25

class TestLTPForge(unittest.TestCase):

    def test_01_sdnv_encoding(self):
        self.assertEqual(encode_sdnv(0), bytes([0x00]))
        self.assertEqual(encode_sdnv(42), bytes([0x2A]))
        # 300 = 2 * 128 + 44 -> 0x82, 0x2C
        self.assertEqual(encode_sdnv(300), bytes([0x82, 0x2C]))

    def test_02_red_green_partitioning(self):
        data = b"RELIABLE_RED_PART_AND_BEST_EFFORT_GREEN_PART"
        res = segment_block(data, seg_size=16, red_bytes=16)
        self.assertEqual(res["redPartBytes"], 16)
        self.assertEqual(res["greenPartBytes"], len(data) - 16)
        self.assertEqual(res["segments"][0]["color"], "RED")
        self.assertEqual(res["segments"][1]["color"], "GREEN")

    def test_03_checkpoint_flag_on_last_red(self):
        data = b"RELIABLE_PAYLOAD_BLOCK"
        res = segment_block(data, seg_size=10, red_bytes=len(data))
        # Last segment must be checkpoint
        last_seg = res["segments"][-1]
        self.assertTrue(last_seg["isCheckpoint"])
        self.assertEqual(last_seg["checkpointSerial"], 1)

    def test_04_green_only_session(self):
        data = b"GREEN_STREAM_ONLY"
        res = segment_block(data, seg_size=8, red_bytes=0)
        self.assertEqual(res["redPartBytes"], 0)
        self.assertTrue(all(s["color"] == "GREEN" for s in res["segments"]))
        self.assertFalse(any(s["isCheckpoint"] for s in res["segments"]))

    def test_05_crc16_trailer_integrity(self):
        data = b"TEST_PAYLOAD"
        res = segment_block(data, seg_size=16)
        seg = res["segments"][0]
        raw = bytes.fromhex(seg["hex"])
        body = raw[:-2]
        c = crc16_x25(body)
        self.assertEqual(seg["crcHex"], f"{c:04X}")

    def test_06_session_id_structure(self):
        res = segment_block(b"TEST", engine_id=42, session_num=999)
        self.assertEqual(res["sessionId"]["engineId"], 42)
        self.assertEqual(res["sessionId"]["sessionNumber"], 999)

    def test_07_end_of_block_segment_type(self):
        res = segment_block(b"FULL_BLOCK", seg_size=16, red_bytes=10)
        last_seg = res["segments"][-1]
        self.assertEqual(last_seg["type"], 3) # Red EORP EOB

    def test_08_normative_auditor_compliance(self):
        report = audit_ltp()
        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(report["score"], "10/10 Normative Rules Compliant")
        self.assertEqual(len(report["rules"]), 10)

    def test_09_multiple_red_segments_offset(self):
        data = b"A" * 64
        res = segment_block(data, seg_size=16, red_bytes=64)
        self.assertEqual(len(res["segments"]), 4)
        for i, s in enumerate(res["segments"]):
            self.assertEqual(s["offset"], i * 16)
            self.assertEqual(s["length"], 16)

    def test_10_empty_payload_safe_handling(self):
        res = segment_block(b"", seg_size=16)
        self.assertEqual(res["totalBytes"], 0)
        self.assertEqual(res["segmentCount"], 0)

if __name__ == "__main__":
    unittest.main()
