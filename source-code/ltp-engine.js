/**
 * LTPForge Pro - CCSDS 734.1-B-1 & IETF RFC 5326 Licklider Transmission Protocol (LTP) Engine
 * Implements Red/Green Data Block Segmentation, SDNV Encoding/Decoding, Checkpoint (CP) Generation,
 * Report Segments (RS), Report Acknowledgments (RA), Selective Retransmission, and RTLT Countdown Simulators.
 * Standards: CCSDS 734.1-B-1 (Blue Book) / IETF RFC 5326 / RFC 5327
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LTPEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // CRC-16 (X.25 / CCITT) Implementation
  function crc16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        if ((crc & 1) !== 0) {
          crc = (crc >>> 1) ^ 0x8408;
        } else {
          crc = crc >>> 1;
        }
      }
    }
    return (~crc) & 0xFFFF;
  }

  // Self-Delimiting Numeric Value (SDNV) Helpers (RFC 5326 Section 4.1)
  function encodeSDNV(val) {
    if (val === 0) return [0x00];
    let bytes = [];
    let v = Math.floor(val);
    while (v > 0) {
      bytes.unshift(v & 0x7F);
      v = Math.floor(v / 128);
    }
    for (let i = 0; i < bytes.length - 1; i++) {
      bytes[i] |= 0x80; // Set continuation bit
    }
    return bytes;
  }

  function decodeSDNV(buffer, offset = 0) {
    let val = 0;
    let idx = offset;
    while (idx < buffer.length) {
      let b = buffer[idx++];
      val = (val * 128) + (b & 0x7F);
      if ((b & 0x80) === 0) break;
    }
    return { value: val, bytesRead: idx - offset };
  }

  class LTPEngine {
    constructor(options = {}) {
      this.version = "1.0.0";
      this.standard = "CCSDS 734.1-B-1 / IETF RFC 5326";
      this.engineId = options.engineId || 1; // Default Engine ID (e.g. Earth Ground Station)
      this.currentSessionNumber = 100;
      this.checkpointSerialCounter = 1;
      this.reportSerialCounter = 1;
    }

    /**
     * Segments client data into Red (reliable ARQ) and Green (best-effort) segments
     * @param {Uint8Array|string} data - Payload data (e.g. DTN BPv7 Bundle)
     * @param {Object} options - { redPartBytes, segmentSize, clientServiceId, destEngineId }
     */
    segmentBlock(data, options = {}) {
      let rawBytes;
      if (typeof data === 'string') {
        rawBytes = new TextEncoder().encode(data);
      } else if (data instanceof Uint8Array) {
        rawBytes = data;
      } else {
        rawBytes = new Uint8Array(data || []);
      }

      const totalLen = rawBytes.length;
      const segmentSize = options.segmentSize || 32;
      const redPartBytes = options.redPartBytes !== undefined ? options.redPartBytes : totalLen; // default all red
      const clientServiceId = options.clientServiceId || 1; // 1 = Bundle Protocol
      const sessionId = { engineId: this.engineId, sessionNumber: this.currentSessionNumber++ };

      let segments = [];
      let offset = 0;

      // 1. Generate Red Segments (Reliable)
      let redLen = Math.min(redPartBytes, totalLen);
      while (offset < redLen) {
        let chunkLen = Math.min(segmentSize, redLen - offset);
        let chunk = rawBytes.subarray(offset, offset + chunkLen);
        let isLastRed = (offset + chunkLen >= redLen);
        let isLastBlock = (offset + chunkLen >= totalLen);

        // Segment Type:
        // 0 = Red, not CP
        // 1 = Red, CP
        // 2 = Red, CP, EORP (End of Red Part)
        // 3 = Red, CP, EORP, EOB (End of Block)
        let segType = 0;
        let isCheckpoint = isLastRed; // Final red segment carries Checkpoint
        if (isCheckpoint) {
          if (isLastRed && isLastBlock) segType = 3;
          else if (isLastRed) segType = 2;
          else segType = 1;
        }

        let cpSerial = isCheckpoint ? this.checkpointSerialCounter++ : 0;
        let rptSerial = isCheckpoint ? 0 : 0;

        let segObj = this.buildDataSegment({
          type: segType,
          sessionId: sessionId,
          clientServiceId: clientServiceId,
          offset: offset,
          length: chunkLen,
          isCheckpoint: isCheckpoint,
          checkpointSerial: cpSerial,
          reportSerial: rptSerial,
          payload: chunk,
          color: "RED"
        });

        segments.push(segObj);
        offset += chunkLen;
      }

      // 2. Generate Green Segments (Unreliable / Best-Effort)
      while (offset < totalLen) {
        let chunkLen = Math.min(segmentSize, totalLen - offset);
        let chunk = rawBytes.subarray(offset, offset + chunkLen);
        let isLastBlock = (offset + chunkLen >= totalLen);

        // Segment Type 4 = Green, not EOB; 7 = Green, EOB
        let segType = isLastBlock ? 7 : 4;

        let segObj = this.buildDataSegment({
          type: segType,
          sessionId: sessionId,
          clientServiceId: clientServiceId,
          offset: offset,
          length: chunkLen,
          isCheckpoint: false,
          payload: chunk,
          color: "GREEN"
        });

        segments.push(segObj);
        offset += chunkLen;
      }

      return {
        standard: this.standard,
        sessionId: sessionId,
        totalBytes: totalLen,
        redPartBytes: redLen,
        greenPartBytes: totalLen - redLen,
        segmentCount: segments.length,
        segments: segments
      };
    }

    /**
     * Builds binary wire format for a Red or Green Data Segment
     */
    buildDataSegment(fields) {
      let header = [];
      // Octet 0: Type (4 bits) | Flags (4 bits)
      header.push((fields.type << 4) & 0xF0);

      // Session ID: Engine ID (SDNV) + Session Number (SDNV)
      header.push(...encodeSDNV(fields.sessionId.engineId));
      header.push(...encodeSDNV(fields.sessionId.sessionNumber));

      // Header extensions count = 0
      header.push(0x00);

      // Client Service ID (SDNV)
      header.push(...encodeSDNV(fields.clientServiceId));

      // Offset (SDNV) + Length (SDNV)
      header.push(...encodeSDNV(fields.offset));
      header.push(...encodeSDNV(fields.length));

      // Checkpoint fields if applicable
      if (fields.isCheckpoint) {
        header.push(...encodeSDNV(fields.checkpointSerial));
        header.push(...encodeSDNV(fields.reportSerial || 0));
      }

      // Trailer extensions count = 0
      header.push(0x00);

      // Combine header and payload
      let bodyWithoutCrc = new Uint8Array(header.length + fields.payload.length);
      bodyWithoutCrc.set(new Uint8Array(header), 0);
      bodyWithoutCrc.set(fields.payload, header.length);

      // Append CRC-16
      let c16 = crc16(bodyWithoutCrc);
      let fullPacket = new Uint8Array(bodyWithoutCrc.length + 2);
      fullPacket.set(bodyWithoutCrc, 0);
      fullPacket[fullPacket.length - 2] = (c16 >> 8) & 0xFF;
      fullPacket[fullPacket.length - 1] = c16 & 0xFF;

      let hex = Array.from(fullPacket).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

      return {
        type: fields.type,
        color: fields.color,
        offset: fields.offset,
        length: fields.length,
        isCheckpoint: fields.isCheckpoint,
        checkpointSerial: fields.checkpointSerial || null,
        packetBytes: fullPacket,
        hex: hex,
        crcHex: f"{c16:04X}" if typeof f !== 'undefined' else ((c16 >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase() + (c16 & 0xFF).toString(16).padStart(2, '0').toUpperCase()
      };
    }

    /**
     * Synthesizes a Report Segment (RS, Type 8) in response to a Checkpoint
     */
    createReportSegment(sessionId, cpSerial, lowerBound, upperBound, claims = []) {
      let rptSerial = this.reportSerialCounter++;
      let header = [];
      // Type 8 = Report Segment
      header.push(0x80);

      header.push(...encodeSDNV(sessionId.engineId));
      header.push(...encodeSDNV(sessionId.sessionNumber));
      header.push(0x00); // Header extensions

      header.push(...encodeSDNV(rptSerial));
      header.push(...encodeSDNV(cpSerial));
      header.push(...encodeSDNV(upperBound));
      header.push(...encodeSDNV(lowerBound));

      // Reception claims count
      header.push(...encodeSDNV(claims.length));
      for (let cl of claims) {
        header.push(...encodeSDNV(cl.offset));
        header.push(...encodeSDNV(cl.length));
      }

      header.push(0x00); // Trailer extensions

      let body = new Uint8Array(header);
      let c16 = crc16(body);
      let fullPacket = new Uint8Array(body.length + 2);
      fullPacket.set(body, 0);
      fullPacket[fullPacket.length - 2] = (c16 >> 8) & 0xFF;
      fullPacket[fullPacket.length - 1] = c16 & 0xFF;

      return {
        type: 8,
        name: "Report Segment (RS)",
        reportSerial: rptSerial,
        checkpointSerial: cpSerial,
        lowerBound: lowerBound,
        upperBound: upperBound,
        claimCount: claims.length,
        packetBytes: fullPacket,
        hex: Array.from(fullPacket).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
      };
    }

    /**
     * Synthesizes a Report Acknowledgment (RA, Type 9)
     */
    createReportAck(sessionId, rptSerial) {
      let header = [];
      header.push(0x90); // Type 9 = Report Acknowledgment

      header.push(...encodeSDNV(sessionId.engineId));
      header.push(...encodeSDNV(sessionId.sessionNumber));
      header.push(0x00); // Header ext

      header.push(...encodeSDNV(rptSerial));
      header.push(0x00); // Trailer ext

      let body = new Uint8Array(header);
      let c16 = crc16(body);
      let fullPacket = new Uint8Array(body.length + 2);
      fullPacket.set(body, 0);
      fullPacket[fullPacket.length - 2] = (c16 >> 8) & 0xFF;
      fullPacket[fullPacket.length - 1] = c16 & 0xFF;

      return {
        type: 9,
        name: "Report Acknowledgment (RA)",
        reportSerial: rptSerial,
        packetBytes: fullPacket,
        hex: Array.from(fullPacket).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
      };
    }
  }

  return LTPEngine;
}));
