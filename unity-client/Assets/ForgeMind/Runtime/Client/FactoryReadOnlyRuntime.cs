using System;
using ForgeMind.Client.Contracts;
using UnityEngine;

namespace ForgeMind.Client
{
    /// <summary>
    /// Read-only U0/U1 runtime. It accepts server payloads and publishes them
    /// to future render systems without inventing a second business truth.
    /// </summary>
    public sealed class FactoryReadOnlyRuntime : MonoBehaviour
    {
        public FactorySaveData CurrentSave { get; private set; }
        public SimulationSnapshotData CurrentSnapshot { get; private set; }
        public string LastError { get; private set; }

        public event Action<FactorySaveData> SaveChanged;
        public event Action<SimulationSnapshotData> SnapshotChanged;
        public event Action<string> ErrorChanged;

        public bool LoadSaveJson(string json)
        {
            if (!ForgeMindJson.TryDeserialize(json, out FactorySaveData save, out var error))
            {
                SetError(error);
                return false;
            }

            ApplySave(save);
            return true;
        }

        public bool LoadEnvelopeJson(string json)
        {
            if (!ForgeMindJson.TryDeserialize(json, out FactorySaveEnvelope envelope, out var error))
            {
                SetError(error);
                return false;
            }

            if (envelope.save == null)
            {
                SetError("Factory save envelope does not contain save data.");
                return false;
            }

            ApplySave(envelope.save);
            return true;
        }

        public bool ApplySnapshotJson(string json)
        {
            if (!ForgeMindJson.TryDeserialize(json, out SimulationSnapshotData snapshot, out var error))
            {
                SetError(error);
                return false;
            }

            ApplySnapshot(snapshot);
            return true;
        }

        public void ApplySave(FactorySaveData save)
        {
            if (save == null)
            {
                SetError("Factory save is null.");
                return;
            }
            CurrentSave = save;
            LastError = string.Empty;
            SaveChanged?.Invoke(save);
        }

        public void ApplySnapshot(SimulationSnapshotData snapshot)
        {
            if (snapshot == null)
            {
                SetError("Simulation snapshot is null.");
                return;
            }
            CurrentSnapshot = snapshot;
            LastError = string.Empty;
            SnapshotChanged?.Invoke(snapshot);
        }

        public void ClearError()
        {
            LastError = string.Empty;
            ErrorChanged?.Invoke(LastError);
        }

        private void SetError(string error)
        {
            LastError = error;
            Debug.LogError($"ForgeMind client payload error: {error}");
            ErrorChanged?.Invoke(error);
        }
    }
}
