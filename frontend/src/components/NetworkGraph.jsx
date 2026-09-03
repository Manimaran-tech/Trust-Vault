import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import {
  Cpu,
  ShieldAlert,
  Zap,
  RotateCw,
  Eye,
  Server,
  Activity,
  Layers
} from 'lucide-react';

const AGENTS_CONFIG = [
  { id: 'identity', name: 'Identity Server', color: 0x2563eb, hex: '#2563EB', role: 'KYC & Biometrics', angle: 0, confidence: 99, latency: '38ms' },
  { id: 'fraud', name: 'Fraud Defense Rack', color: 0xdc2626, hex: '#DC2626', role: 'Velocity & Device Anomaly', angle: Math.PI / 3, confidence: 98, latency: '44ms' },
  { id: 'risk', name: 'Risk Engine Node', color: 0xd97706, hex: '#D97706', role: 'Exposure & Limits', angle: (2 * Math.PI) / 3, confidence: 96, latency: '51ms' },
  { id: 'compliance', name: 'Compliance OPA Pod', color: 0x7c3aed, hex: '#7C3AED', role: 'AML / OFAC Sanctions', angle: Math.PI, confidence: 100, latency: '29ms' },
  { id: 'policy', name: 'Policy Guardian Unit', color: 0x059669, hex: '#059669', role: 'Spend Rules & Tier Caps', angle: (4 * Math.PI) / 3, confidence: 99, latency: '33ms' },
  { id: 'explainability', name: 'Explainability XAI Core', color: 0xd5a96c, hex: '#D5A96C', role: 'Synthesis & Reasoning', angle: (5 * Math.PI) / 3, confidence: 95, latency: '62ms' }
];

export default function NetworkGraph({ events = [], activeAnomaly = null }) {
  const containerRef = useRef(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [liveTps, setLiveTps] = useState(18);

  // References for animation loop
  const sceneRef = useRef(null);
  const coreMeshRef = useRef(null);
  const rogueGatewayRef = useRef(null);
  const serverBladesRef = useRef([]);
  const packetsGroupRef = useRef(null);
  const spawnAnomalyRef = useRef(null);

  // Trigger dedicated Rogue Anomaly Laser when activeAnomaly changes
  useEffect(() => {
    if (activeAnomaly && spawnAnomalyRef.current) {
      spawnAnomalyRef.current(activeAnomaly);
    }
  }, [activeAnomaly]);

  // Three.js Scene Setup & Render Loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight || 500;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.fog = new THREE.FogExp2(0xf4f7f1, 0.0016);

    const camera = new THREE.PerspectiveCamera(42, width / height, 1, 2000);
    camera.position.set(0, 95, 270);
    camera.lookAt(0, 0, 0);

    // 2. WebGL Renderer with High Dynamic Range Tone Mapping
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 3. Studio Cybernetic Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.6);
    mainLight.position.set(120, 200, 140);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xd5a96c, 0.8);
    fillLight.position.set(-140, 80, -100);
    scene.add(fillLight);

    // 4. Data-Center Floor Grid with Fiber Optic Tracks
    const gridHelper = new THREE.GridHelper(380, 38, 0x152d42, 0xd5a96c);
    gridHelper.position.y = -36;
    gridHelper.material.opacity = 0.18;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Helper to generate 3D Floating Glass Label Badges
    const createTextSprite = (title, subtitle, colorHex, isWarning = false) => {
      const canvas = document.createElement('canvas');
      canvas.width = 340;
      canvas.height = 140;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = isWarning ? 'rgba(254, 242, 242, 0.96)' : 'rgba(255, 255, 255, 0.95)';
      ctx.strokeStyle = colorHex;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.roundRect(8, 8, 324, 124, 18);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isWarning ? '#991B1B' : '#152D42';
      ctx.font = 'bold 28px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, 170, 58);

      ctx.fillStyle = colorHex;
      ctx.font = 'bold 19px JetBrains Mono, monospace';
      ctx.fillText(subtitle, 170, 96);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(40, 16.5, 1);
      return sprite;
    };

    // Helper: Realistic 3D Server Blade Chassis Assembly
    const createServerRack = (agentConfig) => {
      const serverGroup = new THREE.Group();

      // Main Server Outer Enclosure (Blackened brushed steel)
      const rackWidth = 14;
      const rackHeight = 32;
      const rackDepth = 14;

      const chassisMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        metalness: 0.85,
        roughness: 0.25
      });
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(rackWidth, rackHeight, rackDepth), chassisMat);
      serverGroup.add(chassis);

      // Server Blade Slots & Activity LED Grilles
      const bladeSlots = 5;
      const bladeHeight = (rackHeight - 6) / bladeSlots;
      const ledsArray = [];

      for (let i = 0; i < bladeSlots; i++) {
        const slotY = (rackHeight / 2) - 4 - (i * bladeHeight);

        // Blade Unit Faceplate (Dark Slate)
        const faceplate = new THREE.Mesh(
          new THREE.BoxGeometry(rackWidth - 1.5, bladeHeight - 1, 0.8),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 })
        );
        faceplate.position.set(0, slotY, rackDepth / 2 + 0.4);
        serverGroup.add(faceplate);

        // Server Status LED (Blinks in loop)
        const ledGeo = new THREE.SphereGeometry(0.5, 8, 8);
        const ledMat = new THREE.MeshBasicMaterial({ color: agentConfig.color });
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.position.set(rackWidth / 2 - 2.5, slotY, rackDepth / 2 + 1.0);
        serverGroup.add(led);
        ledsArray.push(led);

        // Secondary Telemetry LED (Green/Gold)
        const led2 = new THREE.Mesh(
          ledGeo,
          new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x10b981 : 0xd5a96c })
        );
        led2.position.set(rackWidth / 2 - 4.5, slotY, rackDepth / 2 + 1.0);
        serverGroup.add(led2);
        ledsArray.push(led2);
      }

      // Tinted Glass Front Panel
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.6
      });
      const glassDoor = new THREE.Mesh(new THREE.BoxGeometry(rackWidth - 0.5, rackHeight - 2, 0.4), glassMat);
      glassDoor.position.set(0, 0, rackDepth / 2 + 1.2);
      serverGroup.add(glassDoor);

      // Top Neon Underglow Ring on Floor
      const basePedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(11, 12, 1.5, 32),
        new THREE.MeshStandardMaterial({
          color: agentConfig.color,
          emissive: agentConfig.color,
          emissiveIntensity: 0.4,
          metalness: 0.6
        })
      );
      basePedestal.position.y = -rackHeight / 2 - 0.75;
      serverGroup.add(basePedestal);

      // 3D Floating Server Info Badge
      const sprite = createTextSprite(agentConfig.name, `${agentConfig.confidence}% CONF • ${agentConfig.latency}`, agentConfig.hex);
      sprite.position.set(0, rackHeight / 2 + 12, 0);
      serverGroup.add(sprite);

      return { serverGroup, leds: ledsArray };
    };

    // 5. Build 6 MoE 3D Server Racks in Radial Array
    const radius = 95;
    const serverBlades = [];

    AGENTS_CONFIG.forEach(agent => {
      const x = radius * Math.cos(agent.angle);
      const z = radius * Math.sin(agent.angle);

      const { serverGroup, leds } = createServerRack(agent);
      serverGroup.position.set(x, 0, z);
      // Face towards center
      serverGroup.lookAt(0, 0, 0);
      scene.add(serverGroup);

      // High-Speed Fiber Optic Conduit to Central Core
      const curve = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, 0, z));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 20, 0.75, 8, false),
        new THREE.MeshBasicMaterial({ color: agent.color, transparent: true, opacity: 0.35 })
      );
      scene.add(tube);

      serverBlades.push({ group: serverGroup, leds, config: agent, x, z });
    });
    serverBladesRef.current = serverBlades;

    // 6. Central Mainframe Consensus & Governance Supercomputer Tower
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    // Monolithic Hexagonal Tower
    const towerGeo = new THREE.CylinderGeometry(18, 20, 42, 6);
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x152d42,
      metalness: 0.9,
      roughness: 0.15
    });
    const towerMesh = new THREE.Mesh(towerGeo, towerMat);
    coreGroup.add(towerMesh);
    coreMeshRef.current = towerMesh;

    // Golden Core Energy Wireframe
    const energyRing = new THREE.Mesh(
      new THREE.TorusGeometry(23, 0.8, 16, 64),
      new THREE.MeshStandardMaterial({
        color: 0xd5a96c,
        emissive: 0xd5a96c,
        emissiveIntensity: 0.8,
        metalness: 0.8
      })
    );
    energyRing.rotation.x = Math.PI / 2;
    coreGroup.add(energyRing);

    // Floating Mainframe HUD Badge
    const coreSprite = createTextSprite('GOVERNANCE MAINFRAME', 'OPA ENFORCED • 96% CONF', '#D5A96C');
    coreSprite.position.set(0, 36, 0);
    coreGroup.add(coreSprite);

    // 7. Regular Ingress Node (Normal High-Speed Highway)
    const normalIngressGroup = new THREE.Group();
    normalIngressGroup.position.set(-165, 0, 0);

    const normalIngressMesh = new THREE.Mesh(
      new THREE.BoxGeometry(16, 26, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, emissive: 0x2563eb, emissiveIntensity: 0.6, metalness: 0.8 })
    );
    normalIngressGroup.add(normalIngressMesh);

    const normalSprite = createTextSprite('REGULAR INGRESS', '~18 TPS VERIFIED', '#2563EB');
    normalSprite.position.set(0, 24, 0);
    normalIngressGroup.add(normalSprite);
    scene.add(normalIngressGroup);

    const normalCurve = new THREE.LineCurve3(new THREE.Vector3(-165, 0, 0), new THREE.Vector3(0, 0, 0));
    const normalLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(normalCurve.getPoints(20)),
      new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.4 })
    );
    scene.add(normalLine);

    // 8. Rogue / Hacker Ingress Node (Dedicated Crimson Connection for Anomalies)
    const rogueGroup = new THREE.Group();
    rogueGroup.position.set(-155, 30, -110);
    rogueGatewayRef.current = rogueGroup;

    const rogueMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 12, 28, 4),
      new THREE.MeshStandardMaterial({
        color: 0x7f1d1d,
        emissive: 0xdc2626,
        emissiveIntensity: 0.8,
        metalness: 0.9
      })
    );
    rogueGroup.add(rogueMesh);

    const rogueSprite = createTextSprite('ROGUE INGRESS', 'UNTRUSTED OFAC ORIGIN', '#DC2626', true);
    rogueSprite.position.set(0, 26, 0);
    rogueGroup.add(rogueSprite);
    scene.add(rogueGroup);

    // Rogue Laser Conduit to MoE Farm
    const rogueCurve = new THREE.LineCurve3(new THREE.Vector3(-155, 30, -110), new THREE.Vector3(0, 0, 0));
    const rogueLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(rogueCurve.getPoints(24)),
      new THREE.LineBasicMaterial({ color: 0xdc2626, transparent: true, opacity: 0.65 })
    );
    scene.add(rogueLine);

    // 9. High-Speed Transaction Particle System
    const packetsGroup = new THREE.Group();
    scene.add(packetsGroup);
    packetsGroupRef.current = packetsGroup;

    const activePackets = [];

    const spawnNormalPacket = () => {
      const pGeo = new THREE.SphereGeometry(2.0, 10, 10);
      const pMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
      const pMesh = new THREE.Mesh(pGeo, pMat);
      pMesh.position.set(-165, 0, 0);
      packetsGroup.add(pMesh);

      activePackets.push({
        mesh: pMesh,
        progress: 0,
        speed: 0.024 + Math.random() * 0.012,
        isAnomaly: false,
        originX: -165,
        originY: 0,
        originZ: 0,
        targetIdx: Math.floor(Math.random() * AGENTS_CONFIG.length)
      });
    };

    // Callback to spawn the Crimson Anomaly Packet from Rogue Gateway
    spawnAnomalyRef.current = (anomalyData) => {
      const pGeo = new THREE.SphereGeometry(5.0, 16, 16);
      const pMat = new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        emissive: 0xef4444,
        emissiveIntensity: 1.0
      });
      const pMesh = new THREE.Mesh(pGeo, pMat);
      pMesh.position.set(-155, 30, -110);
      packetsGroup.add(pMesh);

      activePackets.push({
        mesh: pMesh,
        progress: 0,
        speed: 0.011,
        isAnomaly: true,
        originX: -155,
        originY: 30,
        originZ: -110,
        targetIdx: 1 // Target Fraud Defense Rack by default
      });
    };

    // 15-20 TPS Continuous Simulation Bursts
    const streamInterval = setInterval(() => {
      spawnNormalPacket();
      spawnNormalPacket();
    }, 100);

    // 3D Interactive Mouse Controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const handleMouseDown = (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      scene.rotation.y += deltaX * 0.005;
      scene.rotation.x = Math.max(-0.4, Math.min(0.4, scene.rotation.x + deltaY * 0.003));

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const handleWheel = (e) => {
      e.preventDefault();
      camera.position.z = Math.max(140, Math.min(420, camera.position.z + e.deltaY * 0.25));
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    dom.addEventListener('wheel', handleWheel, { passive: false });

    // 10. Main Animation & Render Loop
    let animId;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      if (autoRotate && !isDragging) {
        scene.rotation.y += 0.0016;
      }

      // Rotate Mainframe Tower & Energy Ring
      if (coreMeshRef.current) {
        coreMeshRef.current.rotation.y = elapsed * 0.4;
      }
      energyRing.rotation.z = elapsed * 0.8;

      // Pulse Server LEDs
      serverBladesRef.current.forEach((server, sIdx) => {
        server.leds.forEach((led, lIdx) => {
          led.visible = Math.sin(elapsed * 8 + sIdx * 2 + lIdx) > -0.3;
        });
      });

      // Rogue Gateway Alarm Pulse
      if (rogueGatewayRef.current) {
        rogueGatewayRef.current.position.y = 30 + Math.sin(elapsed * 4) * 3;
      }

      // Animate Moving Transaction Packets
      for (let i = activePackets.length - 1; i >= 0; i--) {
        const pkt = activePackets[i];
        pkt.progress += pkt.speed;

        if (pkt.progress <= 1.0) {
          // Phase 1: From Ingress (Normal or Rogue) -> Central Core
          pkt.mesh.position.x = pkt.originX + (0 - pkt.originX) * pkt.progress;
          pkt.mesh.position.y = pkt.originY + (0 - pkt.originY) * pkt.progress + Math.sin(pkt.progress * Math.PI) * 10;
          pkt.mesh.position.z = pkt.originZ + (0 - pkt.originZ) * pkt.progress;
        } else if (pkt.progress <= 2.0) {
          // Phase 2: From Core -> Targeted Server Blade Chassis
          const subP = pkt.progress - 1.0;
          const target = serverBladesRef.current[pkt.targetIdx];
          if (target) {
            pkt.mesh.position.x = target.x * subP;
            pkt.mesh.position.y = 0;
            pkt.mesh.position.z = target.z * subP;
          }
        } else {
          packetsGroup.remove(pkt.mesh);
          pkt.mesh.geometry.dispose();
          pkt.mesh.material.dispose();
          activePackets.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight || 500;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      clearInterval(streamInterval);
      window.removeEventListener('resize', handleResize);
      dom.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      dom.removeEventListener('wheel', handleWheel);
      renderer.dispose();
    };
  }, [autoRotate]);

  return (
    <div className="glass-panel" style={{ padding: 20, position: 'relative', overflow: 'hidden' }}>
      {/* 3D Server Network Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-primary)', margin: 0 }}>
              3D Neural Mixture-of-Experts (MoE) Server Topology
            </h2>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Real 3D Server Blades • Live Blinking LEDs • High-Velocity Stream • Rogue Anomaly Origin
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className="btn-quantum-outline"
            style={{ padding: '4px 10px', fontSize: 11, borderRadius: 20 }}
          >
            <RotateCw className="h-3 w-3" />
            <span>{autoRotate ? 'Pause Orbit' : 'Auto Rotate'}</span>
          </button>

          <div className="telemetry-pill">
            <span className={`status-dot ${activeAnomaly ? 'offline' : 'live'}`} />
            <span>{activeAnomaly ? 'ROGUE INGRESS DETECTED' : 'STREAM: ~18 TPS'}</span>
          </div>

          <div className="telemetry-pill">
            <span>RACKS: <strong>6 ONLINE</strong></span>
          </div>
        </div>
      </div>

      {/* 3D WebGL Server Farm Viewport */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '500px',
          backgroundColor: '#FAFBF9',
          borderRadius: '12px',
          border: '1px solid rgba(21, 45, 66, 0.08)',
          position: 'relative',
          overflow: 'hidden',
          cursor: 'grab'
        }}
      />

      {/* Holographic Alert Overlay when Anomaly Intercepted */}
      {activeAnomaly && (
        <div style={{
          position: 'absolute',
          bottom: 75,
          left: 36,
          right: 36,
          background: 'rgba(254, 242, 242, 0.96)',
          backdropFilter: 'blur(14px)',
          border: '1.5px solid #FECACA',
          borderRadius: 8,
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 10px 30px rgba(220, 38, 38, 0.2)',
          zIndex: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ShieldAlert className="h-6 w-6 text-red-600 animate-pulse" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#991B1B' }}>
                ANOMALY ISOLATED: DISPATCHED FROM ROGUE INGRESS GATEWAY
              </div>
              <div style={{ fontSize: 12, color: '#B91C1C', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                Entity: {activeAnomaly.merchant} • Amount: ${activeAnomaly.amount?.toLocaleString()} • Intercepted by Governance Supercomputer
              </div>
            </div>
          </div>
          <span className="badge-quantum deny">Action Required in Inbox</span>
        </div>
      )}

      {/* Bottom MoE Capability Grid with Live Telemetry Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 12 }}>
        {AGENTS_CONFIG.map(agent => (
          <div
            key={agent.id}
            onClick={() => setSelectedAgent(agent)}
            style={{
              padding: '8px 10px',
              background: '#FFFFFF',
              border: `1px solid ${selectedAgent?.id === agent.id ? agent.hex : 'rgba(21, 45, 66, 0.08)'}`,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              boxShadow: selectedAgent?.id === agent.id ? `0 0 10px ${agent.hex}30` : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <span style={{ fontSize: 15 }}>{agent.icon}</span>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {agent.name.split(' ')[0]}
              </div>
              <div style={{ fontSize: 9.5, color: agent.hex, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {agent.confidence}% • {agent.latency}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
