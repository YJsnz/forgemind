using System;

namespace ForgeMind.Client.Contracts
{
    [Serializable]
    public sealed class AuthRequestData
    {
        public string username;
        public string password;
    }

    [Serializable]
    public sealed class AuthResponseData
    {
        public string token;
        public string username;
    }

    [Serializable]
    public sealed class MeResponseData
    {
        public string id;
        public string username;
    }

    [Serializable]
    public sealed class FactoryProjectSummaryData
    {
        public string id;
        public string name;
        public string createdAt;
        public string updatedAt;
        public int version;
        public int floorCount;
        public int objectCount;
        public int itemCount;
        public int recipeCount;
        public bool autosave;
    }

    [Serializable]
    public sealed class FactoryProjectListData
    {
        public FactoryProjectSummaryData[] items;
    }

    [Serializable]
    public sealed class FactoryProjectResponseData
    {
        public FactoryProjectSummaryData project;
        public FactorySaveData save;
    }

    [Serializable]
    public sealed class SaveProjectRequestData
    {
        public string name;
        public FactorySaveData save;
    }

    [Serializable]
    public sealed class AgentRunReferenceData
    {
        public string id;
        public string factory_id;
        public string status;
        public string summary;
        public AgentResultData result;
    }

    [Serializable]
    public sealed class AgentResultData
    {
        public string headline;
        public string assessment;
        public float confidence;
        public AgentMetricData metrics;
    }

    [Serializable]
    public sealed class AgentMetricData
    {
        public float throughput_per_min;
        public int work_in_progress;
        public int finished_goods;
        public float elapsed_sim_sec;
    }

    [Serializable]
    public sealed class FactorySaveEnvelope
    {
        public string schemaVersion;
        public string projectId;
        public string projectVersion;
        public string projectName;
        public FactorySaveData save;
    }

    [Serializable]
    public sealed class FactorySaveData
    {
        public int version;
        public string savedAt;
        public string name;
        public int floorCount;
        public string[] floorNames;
        public FactoryObjectData[] objects;
        public ItemDefinitionData[] items;
        public RecipeData[] recipes;
        public MachineDefinitionData[] machineDefinitions;
    }

    [Serializable]
    public sealed class MachineDefinitionData
    {
        public string id;
        public string name;
        public string description;
        public string modelType;
        public string importedResourceId;
        public string recipeId;
        public int machineCount;
        public FootprintData footprint;
        public float height;
        public int inputPortCount;
        public int outputPortCount;
        public string[] recipeIds;
    }

    [Serializable]
    public sealed class FootprintData
    {
        public int w = 1;
        public int d = 1;
    }

    [Serializable]
    public sealed class FactoryObjectData
    {
        public string id;
        public string type;
        public string resourceId;
        public int floorId = 1;
        public GridPositionData pos;
        public int rotation;
        public string displayName;
        public string recipeId;
        public string itemId;
        public InclineData incline;
        public StationProgramData stationProgram;
        public AgvProgramData agvProgram;
        public DroneProgramData droneProgram;
    }

    [Serializable]
    public sealed class GridPositionData
    {
        public int x;
        public int z;
    }

    [Serializable]
    public sealed class InclineData
    {
        public string direction;
        public int lowerFloorId;
        public int upperFloorId;
        public GridPositionData lowPos;
        public GridPositionData highPos;
        public float riseM;
        public float runM;
    }

    [Serializable]
    public sealed class StationProgramData
    {
        public string mode;
        public string rackId;
        public float transferIntervalSec;
    }

    [Serializable]
    public sealed class AgvProgramData
    {
        public string sourceId;
        public string itemId;
        public int quantityPerTrip;
        public string destinationId;
        public string strategy;
        public int priority;
    }

    [Serializable]
    public sealed class DroneProgramData
    {
        public string sourceId;
        public string itemId;
        public int quantityPerTrip;
        public string destinationId;
        public string strategy;
        public int priority;
    }

    [Serializable]
    public sealed class ItemDefinitionData
    {
        public string id;
        public string name;
        public string color;
        public string modelId;
        public string modelPath;
    }

    [Serializable]
    public sealed class RecipeData
    {
        public string id;
        public string name;
        public RecipePortData[] inputs;
        public RecipePortData[] outputs;
        public float durationSec;
    }

    [Serializable]
    public sealed class RecipePortData
    {
        public string itemId;
        public int quantity;
        public string side;
    }

    [Serializable]
    public sealed class ImportedResourceData
    {
        public string id;
        public string name;
        public string modelPath;
        public string license;
        public string sourceUrl;
    }

    [Serializable]
    public sealed class SimulationSnapshotData
    {
        public string schemaVersion;
        public string projectId;
        public string projectVersion;
        public int seed;
        public float timeSec;
        public float simTime;
        public bool running;
        public SourceRuntimeData[] sources;
        public ItemLotData[] itemLots;
        public MachineRuntimeData[] machines;
        public VehicleRuntimeData[] agvs;
        public VehicleRuntimeData[] drones;
        public RackRuntimeData[] racks;
        public SimulationMetricsData metrics;
    }

    [Serializable]
    public sealed class SourceRuntimeData
    {
        public string objectId;
        public string itemId;
        public string state;
        public float progress;
        public string mode;
        public string rackSide;
        public string rackObjectId;
    }

    [Serializable]
    public sealed class ItemLotData
    {
        public string id;
        public string itemId;
        public string conveyorId;
        public int floorId = 1;
        public float offset;
    }

    [Serializable]
    public sealed class MachineRuntimeData
    {
        public string objectId;
        public string state;
        public float progress;
    }

    [Serializable]
    public sealed class VehicleRuntimeData
    {
        public string objectId;
        public int floorId = 1;
        public RuntimePositionData position;
        public float headingY;
        public string state;
        public string phase;
        public string motionStatus;
        public string cargoItemId;
        public int cargoQuantity;
        public int waypointIndex;
        public int completedTrips;
        public string currentWaypointLabel;
    }

    [Serializable]
    public sealed class RuntimePositionData
    {
        public float x;
        public float y;
        public float z;
    }

    [Serializable]
    public sealed class RackRuntimeData
    {
        public string objectId;
        public string name;
        public int capacity;
        public RackInventoryEntryData[] inventory;
    }

    [Serializable]
    public sealed class RackInventoryEntryData
    {
        public string itemId;
        public int quantity;
    }

    [Serializable]
    public sealed class SimulationMetricsData
    {
        public float throughputPerHour;
        public float utilization;
        public int output;
        public int consumed;
        public int blocked;
    }

    [Serializable]
    public sealed class UnityBridgeEnvelopeData
    {
        public string protocol;
        public string type;
        public string requestId;
        public UnityBridgePayloadData payload;
    }

    [Serializable]
    public sealed class UnityBridgePayloadData
    {
        public string projectId;
        public string projectVersion;
        public int activeFloor = 1;
        public int[] visibleFloors;
        public FactorySaveData save;
        public SimulationSnapshotData simSnapshot;
        public UnityViewportData viewport;
        public string[] selectedIds;
        public string primaryId;
        public UnityCameraData camera;
        public int targetFps = 60;
    }

    [Serializable]
    public sealed class UnityCameraData
    {
        public RuntimePositionData position;
        public RuntimePositionData target;
        public float fov = 45f;
        public float distance;
        public bool animate = true;
    }

    [Serializable]
    public sealed class UnityViewportData
    {
        public float x;
        public float y;
        public float width;
        public float height;
        public float devicePixelRatio = 1f;
        public bool visible = true;
    }

    [Serializable]
    public sealed class UnityBridgeReadyData
    {
        public string protocol;
        public string clientVersion;
        public string graphicsApi;
        public bool nativeSurface = true;
    }

    [Serializable]
    public sealed class UnityBridgeRenderStatsData
    {
        public float fps;
        public float cpuFrameMs;
        public float gpuFrameMs;
        public int drawCalls;
        public int triangles;
        public long allocatedMemoryBytes;
        public string graphicsApi;
    }
}
